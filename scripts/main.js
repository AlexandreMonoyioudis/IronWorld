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
const GroundAI = Packages.mindustry.ai.types.GroundAI;
const MendProjector = Packages.mindustry.world.blocks.defense.MendProjector;
const Fonts = Packages.mindustry.ui.Fonts;
const Mathf = Packages.arc.math.Mathf;
const Fx = Packages.mindustry.content.Fx;
const Turret = Packages.mindustry.world.blocks.defense.turrets.Turret;
const Building = Packages.mindustry.gen.Building;
const Unit = Packages.mindustry.gen.Unit;
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
        unit.maxHealth = crawlerSegmentCount(unit) * 10;
        unit.health = unit.maxHealth;
        return unit;
    },
    update: function (unit) {
        this.super$update(unit);
        // Mindustry restores maxHealth from the unit type when loading or syncing.
        unit.maxHealth = crawlerSegmentCount(unit) * 10;
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
    const ironCrawler = Vars.content.getByName(ContentType.unit, "ironworld-iron-crawler");
    if (ironCrawler == null) {
        Log.err("[IronWorld] Could not find the Iron Crawler to configure its movement.");
    } else {
        ironCrawler.aiController = createCrawlerAI;
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
