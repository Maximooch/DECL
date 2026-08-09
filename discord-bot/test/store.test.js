const test = require("node:test");
const assert = require("node:assert/strict");
const { LeagueStore, DomainError } = require("../src/store");

function withStore(run) {
    const store = new LeagueStore(":memory:");
    try {
        return run(store);
    } finally {
        store.close();
    }
}

const member = (id, displayName = id) => ({ id, displayName });

test("a Discord user can belong to only one team", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Dragons", member("leader-b"));
    store.addTeamMember("Red Dragons", member("player"));

    assert.throws(
        () => store.addTeamMember("Blue Dragons", member("player")),
        error => error instanceof DomainError && /already on Red Dragons/.test(error.message)
    );
    assert.throws(
        () => store.createTeam("Third Team", member("leader-a")),
        /already on Red Dragons/
    );
}));

test("leadership transfer leaves exactly one stored leader", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.addTeamMember("Red Dragons", member("player-b"));

    const team = store.transferLeadership("Red Dragons", "leader-a", member("player-b"));

    assert.equal(team.leaderId, "player-b");
    assert.deepEqual(
        team.members.map(person => [person.discordId, person.role]),
        [["player-b", "leader"], ["leader-a", "player"]]
    );
    assert.throws(() => store.removeTeamMember("Red Dragons", "player-b"), /Transfer leadership/);
}));

test("a departing leader transfers ownership and an empty team is deleted", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.addTeamMember("Red Dragons", member("player-b"));

    const transferred = store.leaveTeam("leader-a");
    assert.equal(transferred.newLeaderId, "player-b");
    assert.equal(store.getTeam("Red Dragons").leaderId, "player-b");

    const deleted = store.leaveTeam("player-b");
    assert.equal(deleted.deleted, true);
    assert.equal(store.getTeam("Red Dragons"), null);
}));

test("draft picks add the selected player to the picking team atomically", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.openDraft();
    store.joinDraft({ id: "draft-player", ign: "DraftPlayer" });
    store.lockDraft();
    store.joinDraftAsTeam("leader-a");
    store.startDraft(() => 0);

    const result = store.pickDraftPlayer("leader-a", "draftplayer");

    assert.equal(result.player.id, "draft-player");
    assert.equal(result.state.phase, "finished");
    assert.equal(store.getTeamForUser("draft-player").name, "Red Dragons");
    assert.equal(store.getDraftPool().length, 0);
    assert.deepEqual(store.getDraftPicks().map(pick => pick.ign), ["DraftPlayer"]);
}));

test("only the current leader can pick and failed picks do not mutate state", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.openDraft();
    store.joinDraft({ id: "draft-player", ign: "DraftPlayer" });
    store.lockDraft();
    store.joinDraftAsTeam("leader-a");
    store.startDraft(() => 0);

    assert.throws(() => store.pickDraftPlayer("intruder", "DraftPlayer"), /not your team's turn/);
    assert.equal(store.getDraftPool().length, 1);
    assert.equal(store.getTeamForUser("draft-player"), null);
}));

test("matches support multiword names, reject duplicates, and preserve score orientation", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));
    store.createMatch("Red Dragons", "Blue Escape", 2);

    assert.throws(() => store.createMatch("Blue Escape", "Red Dragons", 2), /already exists/);
    assert.throws(() => store.createMatch("Red Dragons", "Red Dragons", 2), /cannot play itself/);

    const score = store.scoreMatch("Blue Escape", "Red Dragons", 3, 1, 2);
    assert.deepEqual(
        { team1: score.team1, team2: score.team2, score1: score.score1, score2: score.score2 },
        { team1: "Blue Escape", team2: "Red Dragons", score1: 3, score2: 1 }
    );
}));
