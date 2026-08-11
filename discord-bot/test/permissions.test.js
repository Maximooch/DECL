const test = require("node:test");
const assert = require("node:assert/strict");
const { isManagement, isTeamLeader } = require("../src/permissions");
const {
    requireManagement,
    requireTeamLeader,
    requireDraftPoolAccess,
    resolveManagedTeam,
    updateLeaderRoles
} = require("../src/commands/helpers");

const config = { managementRoleId: "management", teamLeaderRoleId: "leader" };

function interactionWithRoles(...roles) {
    return { member: { roles: { cache: new Map(roles.map(role => [role, true])) } } };
}

test("management permission is based on the configured role", () => {
    assert.equal(isManagement(interactionWithRoles("management"), config), true);
    assert.equal(isManagement(interactionWithRoles("leader"), config), false);
    assert.throws(() => requireManagement(interactionWithRoles("leader"), config), /Only league management/);
});

test("management is also allowed through team-leader gates", () => {
    assert.equal(isTeamLeader(interactionWithRoles("leader"), config), true);
    assert.equal(isTeamLeader(interactionWithRoles("management"), config), true);
    assert.equal(isTeamLeader(interactionWithRoles(), config), false);
});

test("stored leadership does not bypass the configured Team Leader role", () => {
    const store = {
        getTeamForUser: userId => ({ name: "Red Dragons", leaderId: userId })
    };
    const withoutRole = { ...interactionWithRoles(), user: { id: "leader" } };
    const withRole = { ...interactionWithRoles("leader"), user: { id: "leader" } };

    assert.throws(() => requireTeamLeader(withoutRole, config), /Only a team leader/);
    assert.throws(() => resolveManagedTeam(withoutRole, store, config), /Only a team leader/);
    assert.equal(resolveManagedTeam(withRole, store, config).name, "Red Dragons");
});

test("a stale Team Leader role does not grant locked draft-pool access", () => {
    const store = {
        getTeamForUser: userId => userId === "current-leader"
            ? { name: "Red Dragons", leaderId: userId }
            : null
    };
    const staleLeader = { ...interactionWithRoles("leader"), user: { id: "stale-leader" } };
    const currentLeader = { ...interactionWithRoles("leader"), user: { id: "current-leader" } };
    const management = { ...interactionWithRoles("management"), user: { id: "manager" } };

    assert.throws(() => requireDraftPoolAccess(staleLeader, store, config), /team leader|management/i);
    assert.doesNotThrow(() => requireDraftPoolAccess(currentLeader, store, config));
    assert.doesNotThrow(() => requireDraftPoolAccess(management, store, config));
});

test("leader role synchronization warns when the new member cannot be fetched", async () => {
    const guild = {
        members: {
            fetch: async () => {
                throw new Error("Missing access");
            }
        }
    };

    const warnings = await updateLeaderRoles(guild, "leader", null, "new-leader");

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /assign|fetch|Team Leader/i);
});
