const test = require("node:test");
const assert = require("node:assert/strict");
const { createCommands } = require("../src/commands");

test("every documented command serializes as a slash command", () => {
    const payloads = createCommands({ store: {}, config: {} }).map(command => command.data.toJSON());
    assert.deepEqual(
        payloads.map(command => command.name),
        ["ping", "ign", "roster", "teams", "help", "team", "draft", "match", "results", "week"]
    );

    const draft = payloads.find(command => command.name === "draft");
    assert.deepEqual(
        draft.options.map(option => option.name),
        ["join", "participate", "pick", "view", "status", "open", "lock", "start", "stop"]
    );
});
