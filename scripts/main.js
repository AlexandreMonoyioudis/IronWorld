const Events = Packages.arc.Events;
const Trigger = Packages.mindustry.game.EventType.Trigger;
const Groups = Packages.mindustry.gen.Groups;
const Log = Packages.arc.util.Log;
const Time = Packages.arc.util.Time;
const Vars = Packages.mindustry.Vars;

const ammoFlag = "ironworld-impact-coilgun-ammo";
const powerFlag = "ironworld-impact-coilgun-power";
const defendFlag = "ironworld-impact-defend-first-wave";
const melterPowerFlag = "ironworld-impact-melter-power";
const melterResourcesFlag = "ironworld-impact-melter-resources";
let diagnosticTime = 0;
let melterItemsErrorLogged = false;

Log.info("[IronWorld] Impact Crater turret objective script loaded.");

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
