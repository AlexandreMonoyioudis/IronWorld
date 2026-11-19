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
    const windAir = Vars.content.getByName(ContentType.liquid, "ironworld-wind-air");
    if (alloyShieldWall == null || windAir == null) {
        Log.err("[IronWorld] Could not find the Alloy Shield Wall or Wind Air to configure mend-cycle consumption.");
    } else {
        alloyShieldWall.liquidFilter[windAir.id] = true;
        const windAirPerMend = .5;
        alloyShieldWall.buildType = function () {
            return extend(MendProjector.MendBuild, alloyShieldWall, {
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
                        this.timer.get(alloyShieldWall.timerUse, alloyShieldWall.useTime / this.timeScale) &&
                        canHeal) {
                        this.consume();
                    }

                    if (this.charge >= alloyShieldWall.reload && canHeal) {
                        if (!this.damaged() || this.isHealSuppressed()) {
                            this.charge = 0;
                            return;
                        }

                        if (this.liquids.get(windAir) < windAirPerMend) {
                            this.charge = alloyShieldWall.reload;
                            return;
                        }

                        this.liquids.remove(windAir, windAirPerMend);
                        this.charge = 0;
                        this.heal(
                            this.maxHealth *
                            (alloyShieldWall.healPercent + this.phaseHeat) /
                            100 * this.efficiency
                        );
                        this.recentlyHealed();
                        Fx.healBlockFull.at(
                            this.x,
                            this.y,
                            alloyShieldWall.size,
                            alloyShieldWall.baseColor,
                            alloyShieldWall
                        );
                        alloyShieldWall.mendSound.at(
                            this,
                            1 + Mathf.range(0.1),
                            alloyShieldWall.mendSoundVolume
                        );
                    }
                }
            });
        };
        Log.info("[IronWorld] Alloy Shield Wall configured to consume Wind Air per mend.");
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
