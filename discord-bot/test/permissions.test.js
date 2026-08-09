const test = require("node:test");
const assert = require("node:assert/strict");
const { isManagement, isTeamLeader } = require("../src/permissions");
const { requireManagement } = require("../src/commands/helpers");

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
