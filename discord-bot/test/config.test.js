const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../src/config");

test("configuration reports every missing required variable", () => {
    assert.throws(
        () => loadConfig({ TOKEN: "token" }),
        /CLIENT_ID, GUILD_ID, MANAGEMENT_ROLE_ID, TEAM_LEADER_ROLE_ID/
    );
});

test("configuration resolves the JSON data directory", () => {
    const config = loadConfig({
        TOKEN: "token",
        CLIENT_ID: "client",
        GUILD_ID: "guild",
        MANAGEMENT_ROLE_ID: "management",
        TEAM_LEADER_ROLE_ID: "leader",
        DATA_DIR: "./test-data"
    });
    assert.match(config.dataDirectory, /test-data$/);
    assert.equal(config.databasePath, undefined);
});

test("Docker Compose always stores live data under /data", () => {
    const compose = fs.readFileSync(path.join(__dirname, "..", "docker-compose.example.yml"), "utf8");
    assert.match(compose, /environment:\s+DATA_DIR: \/data/);
    assert.match(compose, /discord-bot-data:\/data/);
});
