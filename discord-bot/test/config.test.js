const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("configuration reports every missing required variable", () => {
    assert.throws(
        () => loadConfig({ TOKEN: "token" }),
        /CLIENT_ID, GUILD_ID, MANAGEMENT_ROLE_ID, TEAM_LEADER_ROLE_ID/
    );
});

test("configuration builds a default SQLite path", () => {
    const config = loadConfig({
        TOKEN: "token",
        CLIENT_ID: "client",
        GUILD_ID: "guild",
        MANAGEMENT_ROLE_ID: "management",
        TEAM_LEADER_ROLE_ID: "leader",
        DATA_DIR: "./test-data"
    });
    assert.match(config.databasePath, /test-data[/\\]decl\.sqlite$/);
});
