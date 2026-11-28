const Events = Packages.arc.Events;
const Core = Packages.arc.Core;
const Trigger = Packages.mindustry.game.EventType.Trigger;
const Groups = Packages.mindustry.gen.Groups;
const Log = Packages.arc.util.Log;
const Time = Packages.arc.util.Time;
const Vars = Packages.mindustry.Vars;
const ContentType = Packages.mindustry.ctype.ContentType;
const TechTreeNode = Packages.mindustry.content.TechTree.TechNode;
const ContentInitEvent = Packages.mindustry.game.EventType.ContentInitEvent;
const WorldLoadEvent = Packages.mindustry.game.EventType.WorldLoadEvent;
const Team = Packages.mindustry.game.Team;
const GroundAI = Packages.mindustry.ai.types.GroundAI;
const BuilderAI = Packages.mindustry.ai.types.BuilderAI;
const MendProjector = Packages.mindustry.world.blocks.defense.MendProjector;
const Fonts = Packages.mindustry.ui.Fonts;
const Mathf = Packages.arc.math.Mathf;
const Fx = Packages.mindustry.content.Fx;
const Turret = Packages.mindustry.world.blocks.defense.turrets.Turret;
const Building = Packages.mindustry.gen.Building;
const Unit = Packages.mindustry.gen.Unit;
const Units = Packages.mindustry.entities.Units;
const UnitType = Packages.mindustry.type.UnitType;
const CrawlUnit = Packages.mindustry.gen.CrawlUnit;
const EntityMapping = Packages.mindustry.gen.EntityMapping;
const Blocks = Packages.mindustry.content.Blocks;
const Liquids = Packages.mindustry.content.Liquids;
const Angles = Packages.arc.math.Angles;
const Draw = Packages.arc.graphics.g2d.Draw;
const crawlerBodies = new java.util.WeakHashMap();
const crawlerSegmentSpacing = 3;
const crawlerResetDistance = 24;
const crawlerSubmergedAlpha = 0.3;
const crawlerMaxDrowning = 0.98;
const crawlerLavaDrownTime = 345;
const cageGuardBuildRadius = 60 * Vars.tilesize;
const cageGuardPursuitRadius = 30 * Vars.tilesize;
let cageGuardType = null;

function teamHasCageGuardCore(team) {
    const cores = team.cores();
    for (let i = 0; i < cores.size; i++) {
        if (cores.get(i).block.unitType.equals(cageGuardType)) return true;
    }
    return false;
}

function createCageGuardBuilderAI() {
    let lastPlan = null;
    let cooldown = 0;
    return extend(BuilderAI, {
        findTarget: function (x, y, range, air, ground) {
            return Units.closestTarget(this.unit.team, x, y, range,
                boolf(function (target) {
                    return target.checkTarget(air, ground);
                }),
                boolf(function () {
                    return false;
                }));
        },
        updateMovement: function () {
            const unit = this.unit;
            const core = unit.closestCore();
            const bullet = unit.type.weapons.first().bullet;
            let enemy = null;
            if (core != null && unit.within(core.x, core.y, cageGuardPursuitRadius)) {
                enemy = Units.closestTarget(unit.team, unit.x, unit.y, this.fleeRange,
                    boolf(function (target) {
                        return target.within(core.x, core.y, cageGuardPursuitRadius) &&
                            target.checkTarget(bullet.collidesAir, bullet.collidesGround);
                    }),
                    boolf(function () {
                        return false;
                    }));
            }
            if (enemy != null) {
                unit.updateBuilding = false;
                this.following = null;
                this.assistFollowing = null;
                unit.lookAt(enemy);
                this.moveTo(enemy, unit.type.range * 0.8, 20);
                return;
            }

            let currentPlan = unit.buildPlan();
            if (lastPlan != null &&
                (currentPlan == null || currentPlan.x !== lastPlan.x || currentPlan.y !== lastPlan.y)) {
                const tile = lastPlan.tile();
                if (tile != null && tile.block().equals(lastPlan.block) && tile.team().equals(this.unit.team)) {
                    cooldown = 5 * Time.toSeconds;
                    lastPlan = null;
                    unit.updateBuilding = false;
                    return;
                }
            }
            lastPlan = null;

            if (cooldown > 0) {
                cooldown = Math.max(0, cooldown - Time.delta);
                if (cooldown > 0) {
                    unit.updateBuilding = false;
                    return;
                }
            }

            if (currentPlan != null &&
                !unit.within(currentPlan.x * Vars.tilesize, currentPlan.y * Vars.tilesize, cageGuardBuildRadius)) {
                unit.clearBuilding();
                unit.vel.setZero();
                currentPlan = null;
            }

            if (currentPlan == null) {
                const plans = unit.team.data().plans;
                for (let i = 0; i < plans.size; i++) {
                    const plan = plans.get(i);
                    if (!unit.within(plan.x * Vars.tilesize, plan.y * Vars.tilesize, cageGuardBuildRadius)) continue;

                    const buildPlan = new Packages.mindustry.entities.units.BuildPlan(
                        plan.x, plan.y, plan.rotation, plan.block, plan.config
                    );
                    if (buildPlan.placeable(unit.team)) {
                        unit.addBuild(buildPlan);
                        break;
                    }
                }
            }

            const previousBuildRadius = BuilderAI.buildRadius;
            this.onlyAssist = true;
            this.following = null;
            this.assistFollowing = null;
            BuilderAI.buildRadius = Math.min(previousBuildRadius, Math.max(1, unit.type.buildRange - unit.type.hitSize * 2));
            try {
                this.super$updateMovement();
            } finally {
                BuilderAI.buildRadius = previousBuildRadius;
            }

            currentPlan = unit.buildPlan();
            this.following = null;
            this.assistFollowing = null;
            if (currentPlan != null &&
                !unit.within(currentPlan.x * Vars.tilesize, currentPlan.y * Vars.tilesize, cageGuardBuildRadius)) {
                unit.clearBuilding();
                unit.vel.setZero();
                unit.updateBuilding = false;
                currentPlan = null;
            }
            lastPlan = this.unit.buildPlan();
        }
    });
}

function crawlerSegmentCount(unit) {
    return Mathf["randomSeed(long,int,int)"](unit.id, 5, unit.type.segments);
}

function crawlerBody(unit) {
    let body = crawlerBodies.get(unit);
    if (body == null || body.id !== unit.id) {
        const segments = [];
        const segmentCount = crawlerSegmentCount(unit);
        // Rhino retains const bindings across loop iterations.
        for (let i = 0; i < segmentCount; i++) {
            var distance = (segmentCount - i) * crawlerSegmentSpacing;
            segments.push({
                x: unit.x + Angles.trnsx(unit.rotation + 180, distance),
                y: unit.y + Angles.trnsy(unit.rotation + 180, distance),
                rotation: unit.rotation,
                submersion: 0,
                lavaFloor: null
            });
        }
        body = {id: unit.id, x: unit.x, y: unit.y, segments: segments, submersion: 0, lavaFloor: null};
        crawlerBodies.put(unit, body);
    }
    return body;
}

function updateCrawlerBody(unit) {
    let body = crawlerBody(unit);
    const dx = unit.x - body.x;
    const dy = unit.y - body.y;
    if (dx * dx + dy * dy > crawlerResetDistance * crawlerResetDistance) {
        crawlerBodies.remove(unit);
        body = crawlerBody(unit);
    }
    body.x = unit.x;
    body.y = unit.y;

    let parentX = unit.x;
    let parentY = unit.y;
    for (let i = body.segments.length - 1; i >= 0; i--) {
        var segment = body.segments[i];
        var x = parentX - segment.x;
        var y = parentY - segment.y;
        var distance = Math.sqrt(x * x + y * y);
        if (distance > 0.001) {
            segment.x = parentX - x * crawlerSegmentSpacing / distance;
            segment.y = parentY - y * crawlerSegmentSpacing / distance;
            segment.rotation = Angles.angle(segment.x, segment.y, parentX, parentY);
        } else {
            segment.x = parentX + Angles.trnsx(segment.rotation + 180, crawlerSegmentSpacing);
            segment.y = parentY + Angles.trnsy(segment.rotation + 180, crawlerSegmentSpacing);
        }
        parentX = segment.x;
        parentY = segment.y;
    }
    return body;
}

function crawlerLavaFloor(x, y) {
    const tile = Vars.world.tileWorld(x, y);
    if (tile == null || tile.block() !== Blocks.air) return null;
    const floor = tile.floor();
    const lava = (floor.isLiquid && floor.liquidDrop === Liquids.slag) ||
        floor.name === "ironworld-molten-iron" ||
        floor.name === "ironworld-molten-iron-hot" ||
        floor.name === "ironworld-molten-iron-warm";
    return lava ? floor : null;
}

function updateCrawlerSubmersion(state, x, y) {
    const floor = crawlerLavaFloor(x, y);
    if (floor != null) {
        state.lavaFloor = floor;
        state.submersion = Math.min(crawlerMaxDrowning, state.submersion + Time.delta / crawlerLavaDrownTime);
    } else {
        state.submersion = Math.max(0, state.submersion - Time.delta / 50);
        if (state.submersion === 0) state.lavaFloor = null;
    }
}

function crawlerDrowningAlpha(progress) {
    return 1 - (1 - crawlerSubmergedAlpha) * progress / crawlerMaxDrowning;
}

const ironCrawlerType = extend(UnitType, "iron-crawler", {
    create: function (team) {
        const unit = this.super$create(team);
        unit.maxHealth = crawlerSegmentCount(unit) * 3;
        unit.health = unit.maxHealth;
        return unit;
    },
    update: function (unit) {
        this.super$update(unit);
        // Mindustry restores maxHealth from the unit type when loading or syncing.
        unit.maxHealth = crawlerSegmentCount(unit) * 3;
        unit.health = Math.min(unit.health, unit.maxHealth);
    },
    applyColor: function (unit) {
        this.super$applyColor(unit);
        if (unit.drownTime > 0) Draw.alpha(crawlerDrowningAlpha(unit.drownTime));
    },
    applyOutlineColor: function (unit) {
        this.super$applyOutlineColor(unit);
        if (unit.drownTime > 0) Draw.alpha(crawlerDrowningAlpha(unit.drownTime));
    },
    drawCrawl: function (unit) {
        const body = updateCrawlerBody(unit);
        const headDrowning = unit.drownTime;
        const headFloor = unit.lastDrownFloor;
        try {
            for (let pass = 0; pass < 2; pass++) {
                var regions = pass === 0 ? this.segmentOutlineRegions : this.segmentRegions;
                for (let i = 0; i < body.segments.length; i++) {
                    var segment = body.segments[i];
                    unit.drownTime = segment.submersion;
                    unit.lastDrownFloor = segment.lavaFloor;
                    this.super$applyColor(unit);
                    if (pass === 0) this.super$applyOutlineColor(unit);
                    if (segment.submersion > 0) Draw.alpha(crawlerDrowningAlpha(segment.submersion));
                    Draw.rect(regions[i], segment.x, segment.y, segment.rotation - 90);
                    if (this.drawCell && pass !== 0 && this.segmentCellRegions[i].found()) {
                        Draw.color(this.cellColor(unit));
                        if (segment.submersion > 0) Draw.alpha(crawlerDrowningAlpha(segment.submersion));
                        Draw.rect(this.segmentCellRegions[i], segment.x, segment.y, segment.rotation - 90);
                    }
                }
            }
        } finally {
            unit.drownTime = headDrowning;
            unit.lastDrownFloor = headFloor;
            Draw.reset();
        }
    }
});
const crawlerEntityProvider = prov(function () {
    return CrawlUnit.create();
});
ironCrawlerType.constructor = crawlerEntityProvider;
// Keep the old entity mapping so previously saved crawlers load with the original hitbox.
EntityMapping.register("ironworld-crawler-hitbox", crawlerEntityProvider);

Events.on(Packages.mindustry.game.EventType.ResetEvent, function () {
    crawlerBodies.clear();
});

Events.run(Trigger.update, function () {
    if (Vars.headless || !Vars.state.isGame() || Vars.state.isPaused()) return;
    Groups.unit.each(function (unit) {
        if (unit.type.id !== ironCrawlerType.id) return;
        const body = updateCrawlerBody(unit);
        updateCrawlerSubmersion(body, unit.x, unit.y);
        for (let i = 0; i < body.segments.length; i++) {
            var segment = body.segments[i];
            updateCrawlerSubmersion(segment, segment.x, segment.y);
        }
        unit.drownTime = body.submersion;
        unit.lastDrownFloor = body.lavaFloor;
    });
});

let invalidCrawlerEntityLogged = false;

function createCrawlerAI() {
    let previousOffset = 0;
    return extend(GroundAI, {
        updateMovement: function () {
            const unit = this.unit;
            if (!(unit instanceof CrawlUnit)) {
                if (!invalidCrawlerEntityLogged) {
                    Log.warn("[IronWorld] A saved Iron Crawler has the wrong entity type. Replace it to restore its body.");
                    invalidCrawlerEntityLogged = true;
                }
                this.super$updateMovement();
                this.super$faceTarget();
                return;
            }
            // Remove the previous steering offset before recalculating the path.
            unit.vel.rotate(-previousOffset);
            this.super$updateMovement();
            previousOffset = unit.vel.isZero(0.01) ? 0 : Mathf.sin(unit.crawlTime, 10, 75);
            unit.vel.rotate(previousOffset);
            this.super$faceTarget();
        },
        // Face once, after applying the new steering offset.
        faceTarget: function () {}
    });
}

const ammoFlag = "ironworld-impact-coilgun-ammo";
const powerFlag = "ironworld-impact-coilgun-power";
const defendFlag = "ironworld-impact-defend-first-wave";
const melterPowerFlag = "ironworld-impact-melter-power";
const melterResourcesFlag = "ironworld-impact-melter-resources";
let diagnosticTime = 0;
let melterItemsErrorLogged = false;
let windAirIconRegistered = false;

Log.info("[IronWorld] Impact Crater turret objective script loaded.");

Events.run(Trigger.uiDrawBegin, function () {
    if (windAirIconRegistered || Vars.headless) return;
    windAirIconRegistered = true;

    const iconRegion = Core.atlas.find("ironworld-wind-air-inline-ui");
    const uiRegion = Core.atlas.find("logo");
    if (!iconRegion.found() || iconRegion.texture != uiRegion.texture) {
        Log.err("[IronWorld] Could not register the Wind Air text icon from the UI atlas.");
        return;
    }

    let iconCode = 0xe000;
    while (iconCode <= 0xf8ff && Fonts.unicodeToName(iconCode) != null) {
        iconCode++;
    }
    if (iconCode > 0xf8ff) {
        Log.err("[IronWorld] No free private-use font character is available for the Wind Air text icon.");
        return;
    }

    Fonts.registerIcon("ironworld-wind-air", "ironworld-wind-air-inline-ui", iconCode, iconRegion);
    Log.info("[IronWorld] Registered the Wind Air text icon.");
});

Events.on(ContentInitEvent, function () {
    const cageGuard = Vars.content.getByName(ContentType.unit, "ironworld-cage-guard");
    if (cageGuard == null) {
        Log.err("[IronWorld] Could not find the Cage Guard to configure its builder AI.");
    } else {
        cageGuardType = cageGuard;
        const defaultController = cageGuard.controller;
        cageGuard.controller = function (unit) {
            return unit.team.isAI() ? createCageGuardBuilderAI() : defaultController.get(unit);
        };
    }

    const ironCrawler = Vars.content.getByName(ContentType.unit, "ironworld-iron-crawler");
    if (ironCrawler == null) {
        Log.err("[IronWorld] Could not find the Iron Crawler to configure its movement.");
    } else {
        ironCrawler.aiController = createCrawlerAI;
    }

    const skimmerFabricator = Vars.content.getByName(ContentType.block, "ironworld-moon-skimmer-fabricator");
    if (skimmerFabricator == null) {
        Log.err("[IronWorld] Could not find the Moon Skimmer Fabricator to add its print-head animation.");
    } else {
        const Layer = Packages.mindustry.graphics.Layer;
        const Fill = Packages.arc.graphics.g2d.Fill;
        const Color = Packages.arc.graphics.Color;
        const UnitFactory = Packages.mindustry.world.blocks.units.UnitFactory;
        const laserColor = Color.valueOf("ffa836");
        const Effect = Packages.mindustry.entities.Effect;
        const Lines = Packages.arc.graphics.g2d.Lines;
        let missingTeamSpriteLogged = false;
        const outlineCache = {};
        function traceIconOutline(pixmap) {
            const edges = [];
            const starts = {};
            function filled(x, y) {
                return x >= 0 && y >= 0 && x < pixmap.width && y < pixmap.height &&
                    pixmap.getA(x, y) >= 128;
            }
            function addEdge(x, y, endX, endY, direction) {
                const edge = {x: x, y: y, endX: endX, endY: endY, direction: direction, used: false};
                const key = x + "," + y;
                if (!starts[key]) starts[key] = [];
                starts[key].push(edge);
                edges.push(edge);
            }
            for (let y = 0; y < pixmap.height; y++) {
                for (let x = 0; x < pixmap.width; x++) {
                    if (!filled(x, y)) continue;
                    if (!filled(x, y - 1)) addEdge(x, y, x + 1, y, 0);
                    if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1, 1);
                    if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1, 2);
                    if (!filled(x - 1, y)) addEdge(x, y + 1, x, y, 3);
                }
            }
            let outline = null;
            let largestArea = 0;
            for (let i = 0; i < edges.length; i++) {
                if (edges[i].used) continue;
                let first = edges[i];
                let edge = first;
                let points = [];
                let area = 0;
                while (edge && !edge.used) {
                    edge.used = true;
                    points.push([edge.x, edge.y]);
                    area += edge.x * edge.endY - edge.endX * edge.y;
                    if (edge.endX == first.x && edge.endY == first.y) {
                        points.push([first.x, first.y]);
                        if (Math.abs(area) > largestArea) {
                            largestArea = Math.abs(area);
                            outline = points;
                        }
                        break;
                    }
                    let choices = starts[edge.endX + "," + edge.endY] || [];
                    let next = null;
                    let bestTurn = 5;
                    for (let j = 0; j < choices.length; j++) {
                        let candidate = choices[j];
                        let turn = (candidate.direction - edge.direction + 4) % 4;
                        let rank = (turn + 3) % 4;
                        if (!candidate.used && rank < bestTurn) {
                            next = candidate;
                            bestTurn = rank;
                        }
                    }
                    edge = next;
                }
            }
            return outline;
        }
        function findSprite(directory, filename) {
            if (!directory.exists()) return null;
            const pending = [directory];
            while (pending.length > 0) {
                var files = pending.pop().list();
                for (var i = 0; i < files.length; i++) {
                    if (files[i].isDirectory()) {
                        pending.push(files[i]);
                    } else if (String(files[i].name()) == filename) {
                        return files[i];
                    }
                }
            }
            return null;
        }
        function getUnitOutline(unit) {
            const icon = unit.fullIcon;
            const cached = outlineCache[unit.name];
            if (cached && cached.icon.equals(icon)) return cached;
            const mod = unit.minfo.mod;
            let sprite = null;
            if (mod != null) {
                const name = String(unit.name);
                const prefix = String(mod.name) + "-";
                const spriteName = name.indexOf(prefix) == 0 ? name.substring(prefix.length) : name;
                sprite = findSprite(mod.root.child("sprites"), spriteName + ".png");
            }
            let outline = null;
            if (sprite != null) {
                const pixmap = new Packages.arc.graphics.Pixmap(sprite);
                try {
                    const points = traceIconOutline(pixmap);
                    if (points != null) {
                        outline = {icon: icon, points: points, width: pixmap.width, height: pixmap.height};
                    }
                } finally {
                    pixmap.dispose();
                }
            }
            if (outline == null) {
                Log.err("[IronWorld] Could not find a drawable source sprite for @; using a rectangular print path.", unit.name);
                outline = {
                    icon: icon, width: icon.width, height: icon.height,
                    points: [[0, 0], [icon.width, 0], [icon.width, icon.height], [0, icon.height], [0, 0]]
                };
            }
            outlineCache[unit.name] = outline;
            return outline;
        }
        // A scaled-down copy of Fx.sparkShoot: a third of the size and a quarter of the lifetime.
        const nozzleSpark = new Effect(3, function (e) {
            Draw.color(Color.valueOf("ffa836"), Color.white, e.fin());
            Lines.stroke(e.fout() * 0.4 + 0.2);
            for (let i = 0; i < 3; i++) {
                Mathf.rand.setSeed(e.id * 31 + i);
                const angle = Mathf.rand.random(360);
                const dist = e.finpow() * 8 * Mathf.rand.random(0.5, 1);
                Lines.lineAngle(
                    e.x + Mathf.cosDeg(angle) * dist,
                    e.y + Mathf.sinDeg(angle) * dist,
                    angle,
                    e.fout() * 1.7 + 0.2
                );
            }
            Draw.reset();
        });
        skimmerFabricator.buildType = function () {
            return extend(UnitFactory.UnitFactoryBuild, skimmerFabricator, {
                printWarm: 0,
                updateTile: function () {
                    this.super$updateTile();
                    const printing = this.efficiency > 0 && this.currentPlan != -1 && this.payload == null;
                    this.printWarm = Mathf.lerpDelta(this.printWarm, printing ? 1 : 0, 0.05);
                    if (printing && this.printWarm > 0.5 && this.printingPass && this.nozzleX !== undefined && Mathf.chance(0.35 * Time.delta)) {
                        nozzleSpark.at(this.nozzleX, this.nozzleY);
                    }
                },
                draw: function () {
                    // Hide the vanilla build effect (yellow tint and scan line) by drawing without a current plan,
                    // then draw the unit fading in ourselves.
                    const realPlan = this.currentPlan;
                    this.currentPlan = -1;
                    this.super$draw();
                    this.currentPlan = realPlan;
                    const teamRegion = Core.atlas.find(skimmerFabricator.name + "-team");
                    if (teamRegion.found()) {
                        const progress = Mathf.clamp(this.fraction());
                        if (progress > 0) {
                            // The strip occupies pixels 31 through 64 of the 96-pixel sprite.
                            const visible = (31 + 34 * progress) / 96;
                            const partial = new Packages.arc.graphics.g2d.TextureRegion(teamRegion);
                            partial.setU2(teamRegion.u + (teamRegion.u2 - teamRegion.u) * visible);
                            const width = teamRegion.width * teamRegion.scl();
                            const height = teamRegion.height * teamRegion.scl();
                            Draw.z(Layer.blockOver + 0.3);
                            Draw.color(this.team.color);
                            Draw.rect(partial, this.x - width * (1 - visible) / 2, this.y, width * visible, height);
                            Draw.color();
                        }
                    } else if (!missingTeamSpriteLogged) {
                        Log.err("[IronWorld] Could not find the Moon Skimmer Fabricator team sprite.");
                        missingTeamSpriteLogged = true;
                    }
                    if (realPlan != -1 && this.payload == null) {
                        Draw.z(Layer.blockOver);
                        Draw.alpha(this.fraction());
                        Draw.rect(this.unit().fullIcon, this.x, this.y, this.rotdeg() - 90);
                        Draw.reset();
                    }
                    const warm = this.printWarm;
                    // The base and top sprites don't rotate, so the beam and head stay fixed as well.
                    const rot = 0;
                    const sweepAngle = (rot - 90) * Mathf.degRad;
                    const beamAngle = rot * Mathf.degRad;
                    const sweepX = Math.cos(sweepAngle);
                    const sweepY = Math.sin(sweepAngle);
                    const beamX = Math.cos(beamAngle);
                    const beamYDir = Math.sin(beamAngle);

                    // Transform the sprite outline to match the unit's displayed rotation.
                    const unit = realPlan != -1 ? this.unit() : skimmerFabricator.plans.get(0).unit;
                    const icon = unit.fullIcon;
                    const width = icon.width * icon.scl();
                    const height = icon.height * icon.scl();
                    const unitAngle = (this.rotdeg() - 90) * Mathf.degRad;
                    const cos = Math.cos(unitAngle);
                    const sin = Math.sin(unitAngle);
                    const outline = getUnitOutline(unit);
                    const path = outline.points.map(function (point) {
                        const x = (point[0] / outline.width - 0.5) * width;
                        const y = (0.5 - point[1] / outline.height) * height;
                        return [x * cos - y * sin, -(x * sin + y * cos)];
                    });
                    const halfW = Mathf.clamp(width / 2, 3, 8);
                    const inner = halfW - 1.5;
                    const legs = 8;
                    for (let i = 0; i <= legs; i++) {
                        path.push([i % 2 == 0 ? -inner : inner, -inner + (2 * inner * i) / legs]);
                    }
                    let pathLength = 0;
                    for (let i = 1; i < path.length; i++) {
                        pathLength += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
                    }
                    const printShare = 0.85;
                    const cycle = (this.time / 240) % 1;
                    let pathA;
                    let pathB;
                    let printingPass = false;
                    if (cycle < printShare) {
                        printingPass = true;
                        let remaining = (cycle / printShare) * pathLength;
                        pathA = path[path.length - 1][0];
                        pathB = path[path.length - 1][1];
                        for (let i = 1; i < path.length; i++) {
                            let segment = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
                            if (remaining <= segment) {
                                const f = remaining / segment;
                                pathA = Mathf.lerp(path[i - 1][0], path[i][0], f);
                                pathB = Mathf.lerp(path[i - 1][1], path[i][1], f);
                                break;
                            }
                            remaining -= segment;
                        }
                    } else {
                        const f = Mathf.clamp((cycle - printShare) / (1 - printShare));
                        const eased = f * f * (3 - 2 * f);
                        const last = path[path.length - 1];
                        pathA = Mathf.lerp(last[0], path[0][0], eased);
                        pathB = Mathf.lerp(last[1], path[0][1], eased);
                    }
                    this.printingPass = printingPass;

                    // The nozzle tip is below the centre of the head sprite.
                    const along = Mathf.lerp(-8.5, pathB - 1.6, warm);
                    const across = pathA * warm;
                    const beam = Core.atlas.find("ironworld-moon-skimmer-fabricator-beam");
                    const head = Core.atlas.find("ironworld-moon-skimmer-fabricator-head");
                    const bx = this.x + sweepX * along;
                    const by = this.y + sweepY * along;
                    const hx = bx + beamX * across;
                    const hy = by + beamYDir * across;
                    this.nozzleX = hx + sweepX * 1.6;
                    this.nozzleY = hy + sweepY * 1.6;

                    Draw.z(Layer.blockOver + 0.2);
                    Draw.rect(beam, bx, by, 19, 2.5, rot);
                    Draw.rect(head, hx, hy, 3.5, 3.5, rot);
                    if (warm > 0.05 && this.printingPass) {
                        Draw.color(laserColor);
                        Draw.alpha(warm * (0.6 + Mathf.absin(Time.time, 4, 0.4)));
                        Fill.circle(this.nozzleX, this.nozzleY, 0.6);
                    }
                    Draw.reset();
                }
            });
        };
    }

    const permendur = Vars.content.getByName(ContentType.item, "ironworld-Permendur");
    const slag = Vars.content.getByName(ContentType.liquid, "slag");
    if (permendur == null || slag == null) {
        Log.err("[IronWorld] Could not find Permendur or vanilla Slag to add the IronWorld tech-tree node.");
    } else if (permendur.techNode == null) {
        Log.err("[IronWorld] Permendur has no tech-tree node; could not add Slag after it.");
    } else {
        const existingSlagNode = slag.techNode;
        new TechTreeNode(permendur.techNode, slag, slag.researchRequirements());
        if (existingSlagNode != null) {
            slag.techNode = existingSlagNode;
        }
        Log.info("[IronWorld] Added a Slag node after Permendur without replacing existing tech-tree nodes.");
    }

    const alloyShieldWall = Vars.content.getByName(ContentType.block, "ironworld-alloy-shield-wall");
    const reinforcedAlloyShieldWall = Vars.content.getByName(ContentType.block, "ironworld-reinforced-alloy-shield-wall");
    const windAir = Vars.content.getByName(ContentType.liquid, "ironworld-wind-air");
    if (windAir == null) {
        Log.err("[IronWorld] Could not find Wind Air to configure mend-cycle consumption.");
    } else {
        const windAirPerMend = 5;
        function configureShieldWall(block) {
            block.liquidFilter[windAir.id] = true;
            block.buildType = function () {
                return extend(MendProjector.MendBuild, block, {
                    updateTile: function () {
                        const canHeal = !this.checkSuppression();
                        const hasMendAir = this.liquids.get(windAir) >= windAirPerMend;

                        this.smoothEfficiency = Mathf.lerpDelta(this.smoothEfficiency, this.efficiency, 0.08);
                        this.heat = Mathf.lerpDelta(
                            this.heat,
                            this.efficiency > 0 && canHeal && this.damaged() && hasMendAir ? 1 : 0,
                            0.08
                        );
                        this.charge += this.heat * this.delta();
                        this.phaseHeat = Mathf.lerpDelta(this.phaseHeat, this.optionalEfficiency, 0.1);

                        if (this.optionalEfficiency > 0 &&
                            this.timer.get(block.timerUse, block.useTime / this.timeScale) &&
                            canHeal) {
                            this.consume();
                        }

                        if (this.charge >= block.reload && canHeal) {
                            if (!this.damaged() || this.isHealSuppressed()) {
                                this.charge = 0;
                                return;
                            }

                            if (this.efficiency <= 0 || this.liquids.get(windAir) < windAirPerMend) {
                                this.charge = block.reload;
                                return;
                            }

                            this.liquids.remove(windAir, windAirPerMend);
                            this.charge = 0;
                            this.heal(
                                this.maxHealth *
                                (block.healPercent + this.phaseHeat) /
                                100 * this.efficiency
                            );
                            this.recentlyHealed();
                            Fx.healBlockFull.at(
                                this.x,
                                this.y,
                                block.size,
                                block.baseColor,
                                block
                            );
                            block.mendSound.at(
                                this,
                                1 + Mathf.range(0.1),
                                block.mendSoundVolume
                            );
                        }
                    }
                });
            };
        }

        if (alloyShieldWall == null) {
            Log.err("[IronWorld] Could not find the Alloy Shield Wall to configure mend-cycle consumption.");
        } else {
            configureShieldWall(alloyShieldWall);
            Log.info("[IronWorld] Alloy Shield Wall configured to consume Wind Air per mend.");
        }

        if (reinforcedAlloyShieldWall == null) {
            Log.err("[IronWorld] Could not find the Reinforced Alloy Shield Wall to configure mend-cycle consumption.");
        } else {
            configureShieldWall(reinforcedAlloyShieldWall);
            Log.info("[IronWorld] Reinforced Alloy Shield Wall configured to consume Wind Air per mend.");
        }
    }

    const pointer = Vars.content.getByName(ContentType.unit, "ironworld-pointer");
    if (pointer == null) {
        Log.err("[IronWorld] Could not find the Pointer unit to configure its combat movement.");
        return;
    }

    pointer.aiController = function () {
        return extend(GroundAI, {
            updateMovement: function () {
                const target = this.target;
                if (target != null &&
                    !this.invalid(target) &&
                    ((target instanceof Building && target.block instanceof Turret) ||
                        (target instanceof Unit && target.isPlayer())) &&
                    this.unit.within(target, this.unit.type.range*.9)) {
                    this.unit.vel.setZero();
                    this.faceTarget();
                    return;
                }

                this.super$updateMovement();
            }
        });
    };
    Log.info("[IronWorld] Pointer combat movement configured.");
});

Events.on(WorldLoadEvent, function () {
    if (!Vars.state.isCampaign() || Vars.state.getPlanet().name !== "ironworld-IronWorld") return;

    for (let i = 0; i < Team.all.length; i++) {
        const team = Team.all[i];
        if (team === Team.derelict || !team.isAI()) continue;

        const rules = team.rules();
        rules.infiniteResources = false;
        if (typeof rules.fillItems !== "undefined") rules.fillItems = false;
        rules.buildAi = teamHasCageGuardCore(team);
    }
});

function findCoilgun() {
    let found = null;
    Groups.build.each(function (building) {
        const blockName = String(building.block.name).toLowerCase();
        const localizedName = String(building.block.localizedName).toLowerCase();
        if (blockName.indexOf("coilgun") !== -1 || localizedName.indexOf("coilgun") !== -1) {
            found = building;
        }
    });
    return found;
}

function findMelter() {
    let found = null;
    Groups.build.each(function (building) {
        const blockName = String(building.block.name).toLowerCase();
        const localizedName = String(building.block.localizedName).toLowerCase();
        if ((blockName.indexOf("vacuum") !== -1 && blockName.indexOf("melter") !== -1) ||
            (localizedName.indexOf("vacuum") !== -1 && localizedName.indexOf("melter") !== -1)) {
            found = building;
        }
    });
    return found;
}

Events.run(Trigger.update, function () {
    const state = Vars.state;
    if (state == null || state.rules == null || state.rules.objectives == null) return;

    const rules = state.rules;
    if (rules.objectiveFlags.contains(powerFlag) &&
        !rules.objectiveFlags.contains(defendFlag) &&
        state.wave >= 2 &&
        state.enemies <= 0) {
        rules.objectiveFlags.add(defendFlag);
        Log.info("[IronWorld] First wave defeated; defense objective completed.");
    }

    const turret = findCoilgun();
    diagnosticTime += Time.delta;
    if (turret == null) {
        if (diagnosticTime >= 600) {
            Log.info("[IronWorld] No Coilgun found in the building group; waiting for the turret.");
        }
    } else {
        if (!rules.objectiveFlags.contains(ammoFlag)) {
            const ammo = turret.totalAmmo;
            if (ammo >= turret.block.ammoPerShot) {
                rules.objectiveFlags.add(ammoFlag);
                Log.info("[IronWorld] Coilgun ammo objective completed: @/@ ammo.", ammo, turret.block.ammoPerShot);
            } else if (diagnosticTime >= 600) {
                Log.info("[IronWorld] Coilgun found (@); ammo @/@.", turret.block.name, ammo, turret.block.ammoPerShot);
            }
        }

        if (rules.objectiveFlags.contains(ammoFlag) && !rules.objectiveFlags.contains(powerFlag)) {
            const powerStatus = turret.sense(Packages.mindustry.logic.LAccess.totalPower);
            if (powerStatus >= 0.50) {
                rules.objectiveFlags.add(powerFlag);
                Log.info("[IronWorld] Coilgun power objective completed at @% satisfaction.", powerStatus * 100);
            } else if (diagnosticTime >= 600) {
                Log.info("[IronWorld] Coilgun power satisfaction is @%.", powerStatus * 100);
            }
        }
    }

    const melter = findMelter();
    if (melter != null && !rules.objectiveFlags.contains(melterPowerFlag)) {
        const powerStatus = melter.sense(Packages.mindustry.logic.LAccess.totalPower);
        if (powerStatus >= 0.50) {
            rules.objectiveFlags.add(melterPowerFlag);
            Log.info("[IronWorld] Vacuum Induction Melter power objective completed at @% satisfaction.", powerStatus * 100);
        } else if (diagnosticTime >= 600) {
            Log.info("[IronWorld] Vacuum Induction Melter power satisfaction is @%.", powerStatus * 100);
        }
    }

    if (melter != null &&
        rules.objectiveFlags.contains(melterPowerFlag) &&
        !rules.objectiveFlags.contains(melterResourcesFlag)) {
        const iron = Vars.content.item("ironworld-Iron");
        const cobalt = Vars.content.item("ironworld-Cobalt");
        const permendur = Vars.content.item("ironworld-Permendur");
        if (iron == null || cobalt == null || permendur == null) {
            if (!melterItemsErrorLogged) {
                Log.err("[IronWorld] Could not find Iron, Cobalt, or Permendur content for the melter resource objective.");
                melterItemsErrorLogged = true;
            }
        } else {
            const hasInputs = melter.sense(iron) >= 1 && melter.sense(cobalt) >= 1;
            const hasCraftedOutput = melter.sense(permendur) >= 2;
            if (hasInputs || hasCraftedOutput) {
                rules.objectiveFlags.add(melterResourcesFlag);
                Log.info("[IronWorld] Vacuum Induction Melter resource objective completed.");
            } else if (diagnosticTime >= 600) {
                Log.info("[IronWorld] Vacuum Induction Melter needs at least 1 Iron and 1 Cobalt.");
            }
        }
    }

    if (diagnosticTime >= 600) diagnosticTime = 0;
});
