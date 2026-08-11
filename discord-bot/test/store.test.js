const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LeagueStore, DomainError } = require("../src/store");

const SHIPPED_DATA_DIRECTORY = path.join(__dirname, "..", "data");

function writeJson(filename, value) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, `${JSON.stringify(value, null, 4)}\n`);
}

function createDataDirectory({ shipped = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "decl-store-test-"));
    const dataDirectory = path.join(root, "data");

    if (shipped) {
        fs.cpSync(SHIPPED_DATA_DIRECTORY, dataDirectory, { recursive: true });
    } else {
        writeJson(path.join(dataDirectory, "teams.json"), []);
        writeJson(path.join(dataDirectory, "players.json"), []);
        writeJson(path.join(dataDirectory, "draft.json"), {
            phase: "closed",
            players: [],
            teams: [],
            turnOrder: [],
            currentPick: 0,
            picked: []
        });
        writeJson(path.join(dataDirectory, "tournaments", "active.json"), { week: 1 });
        writeJson(path.join(dataDirectory, "tournaments", "weeks", "week1.json"), []);
    }

    return { root, dataDirectory };
}

function withStore(run, options) {
    const fixture = createDataDirectory(options);
    const store = new LeagueStore(fixture.dataDirectory);
    try {
        return run(store, fixture.dataDirectory);
    } finally {
        store.close();
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
}

function reopenStore(store, dataDirectory) {
    store.close();
    return new LeagueStore(dataDirectory);
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

test("leadership can transfer to a substitute on a full main roster", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.addTeamMember("Red Dragons", member("player-b"));
    store.addTeamMember("Red Dragons", member("player-c"));
    store.addTeamMember("Red Dragons", member("player-d"));
    store.addTeamMember("Red Dragons", member("substitute-e"), "substitute");

    const team = store.transferLeadership("Red Dragons", "leader-a", member("substitute-e"));

    assert.equal(team.leaderId, "substitute-e");
    assert.equal(team.members.find(person => person.discordId === "substitute-e").role, "leader");
    assert.equal(team.members.find(person => person.discordId === "leader-a").role, "substitute");
    assert.equal(team.members.filter(person => person.role !== "substitute").length, 4);
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

test("JSON changes survive reopening and retain the previous file as a backup", () => withStore((store, dataDirectory) => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));

    const teamsPath = path.join(dataDirectory, "teams.json");
    const backup = JSON.parse(fs.readFileSync(`${teamsPath}.bak`, "utf8"));
    assert.deepEqual(backup.map(team => team.name), ["Red Dragons"]);

    store.setIgn("draft-player", "DraftPlayer");
    store.setActiveWeek(2);
    store.createMatch("Red Dragons", "Blue Escape", 2);
    store.scoreMatch("Red Dragons", "Blue Escape", 4, 2, 2);
    store.openDraft();
    store.joinDraft({ id: "draft-player", ign: "DraftPlayer" });

    const reopened = reopenStore(store, dataDirectory);
    try {
        assert.equal(reopened.getIgn("draft-player"), "DraftPlayer");
        assert.deepEqual(reopened.listTeams().map(team => team.name), ["Blue Escape", "Red Dragons"]);
        assert.equal(reopened.getActiveWeek(), 2);
        assert.deepEqual(
            reopened.listMatches(2).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
            [{ team1: "Red Dragons", team2: "Blue Escape", score1: 4, score2: 2 }]
        );
        assert.deepEqual(reopened.getDraftPool(), [{ discordId: "draft-player", ign: "DraftPlayer" }]);
    } finally {
        reopened.close();
    }
}));

test("draft picks persist the roster and draft state together", () => withStore((store, dataDirectory) => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.openDraft();
    store.joinDraft({ id: "draft-player", ign: "DraftPlayer" });
    store.lockDraft();
    store.joinDraftAsTeam("leader-a");
    store.startDraft(() => 0);

    const result = store.pickDraftPlayer("leader-a", "draftplayer");
    assert.equal(result.player.id, "draft-player");
    assert.equal(result.state.phase, "finished");

    const reopened = reopenStore(store, dataDirectory);
    try {
        assert.equal(reopened.getTeamForUser("draft-player").name, "Red Dragons");
        assert.equal(reopened.getDraftPool().length, 0);
        assert.deepEqual(reopened.getDraftPicks().map(pick => pick.ign), ["DraftPlayer"]);
        assert.equal(reopened.getDraftState().phase, "finished");
    } finally {
        reopened.close();
    }
}));

test("an interrupted multi-file write is replayed on restart", () => withStore((store, dataDirectory) => {
    store.createTeam("Red Dragons", member("leader-a"));
    const teams = JSON.parse(fs.readFileSync(path.join(dataDirectory, "teams.json"), "utf8"));
    teams.push({
        name: "Blue Escape",
        leader: "leader-b",
        members: [{ id: "leader-b", name: "leader-b", role: "leader" }],
        stats: { wins: 0, losses: 0, points: 0 }
    });
    const draft = {
        phase: "open",
        players: [],
        teams: [],
        turnOrder: [],
        currentPick: 0,
        picked: []
    };
    writeJson(path.join(dataDirectory, ".pending-transaction.json"), {
        version: 1,
        writes: [
            { relative: "teams.json", content: `${JSON.stringify(teams, null, 4)}\n` },
            { relative: "draft.json", content: `${JSON.stringify(draft, null, 4)}\n` }
        ]
    });

    const recovered = reopenStore(store, dataDirectory);
    try {
        assert.deepEqual(recovered.listTeams().map(team => team.name), ["Blue Escape", "Red Dragons"]);
        assert.equal(recovered.getDraftState().phase, "open");
        assert.equal(fs.existsSync(path.join(dataDirectory, ".pending-transaction.json")), false);
    } finally {
        recovered.close();
    }
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

test("full-roster teams cannot enter and deadlock the draft", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.addTeamMember("Red Dragons", member("player-a"));
    store.addTeamMember("Red Dragons", member("player-b"));
    store.addTeamMember("Red Dragons", member("player-c"));
    store.openDraft();
    store.joinDraft({ id: "draft-player", ign: "DraftPlayer" });
    store.lockDraft();

    assert.throws(
        () => store.joinDraftAsTeam("leader-a"),
        error => error instanceof DomainError && /roster|full|4/i.test(error.message)
    );
    assert.throws(() => store.startDraft(() => 0), /No teams have joined/);
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

test("disbanding a team preserves its Week 1 match history", () => withStore((store, dataDirectory) => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));
    store.createMatch("Red Dragons", "Blue Escape", 1);

    store.disbandTeam("Red Dragons");
    store.scoreMatch("Red Dragons", "Blue Escape", 4, 2, 1);

    const reopened = reopenStore(store, dataDirectory);
    try {
        assert.deepEqual(
            reopened.listMatches(1).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
            [{ team1: "Red Dragons", team2: "Blue Escape", score1: 4, score2: 2 }]
        );
    } finally {
        reopened.close();
    }
}));

test("deleting a sole leader's team preserves its Week 1 match history", () => withStore((store, dataDirectory) => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));
    store.createMatch("Red Dragons", "Blue Escape", 1);
    store.scoreMatch("Red Dragons", "Blue Escape", 4, 2, 1);

    const result = store.leaveTeam("leader-a");
    assert.equal(result.deleted, true);

    const reopened = reopenStore(store, dataDirectory);
    try {
        assert.deepEqual(
            reopened.listMatches(1).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
            [{ team1: "Red Dragons", team2: "Blue Escape", score1: 4, score2: 2 }]
        );
    } finally {
        reopened.close();
    }
}));

test("shipped JSON keeps archived matches readable and draft players unrostered", () => withStore(store => {
    const teams = JSON.parse(fs.readFileSync(path.join(SHIPPED_DATA_DIRECTORY, "teams.json"), "utf8"));
    const draft = JSON.parse(fs.readFileSync(path.join(SHIPPED_DATA_DIRECTORY, "draft.json"), "utf8"));
    const rosteredIds = new Set(teams.flatMap(team => (team.members || []).map(person => person.id)));

    assert.equal(draft.players.some(player => rosteredIds.has(player.id)), false);
    assert.equal(store.getActiveWeek(), 2);
    assert.deepEqual(
        store.listMatches(1).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
        [{ team1: "N64", team2: "WinnersPOV", score1: 109, score2: 61 }]
    );
}, { shipped: true }));

test("one-time seeding does not resurrect intentionally deleted teams", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "decl-seed-test-"));
    const dataDirectory = path.join(root, "data");

    try {
        const store = new LeagueStore(dataDirectory, SHIPPED_DATA_DIRECTORY);
        for (const team of store.listTeams()) store.disbandTeam(team.name);
        store.close();

        const reopened = new LeagueStore(dataDirectory, SHIPPED_DATA_DIRECTORY);
        assert.equal(reopened.listTeams().length, 0);
        reopened.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("legacy SQLite data blocks JSON bootstrapping instead of being overwritten", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "decl-sqlite-guard-test-"));
    const dataDirectory = path.join(root, "data");
    const databasePath = path.join(dataDirectory, "decl.sqlite");
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(databasePath, "legacy database bytes");

    try {
        assert.throws(
            () => new LeagueStore(dataDirectory, SHIPPED_DATA_DIRECTORY),
            /decl\.sqlite|SQLite|legacy database/i
        );
        assert.equal(fs.readFileSync(databasePath, "utf8"), "legacy database bytes");
        assert.equal(fs.existsSync(path.join(dataDirectory, "teams.json")), false);
        assert.equal(fs.existsSync(path.join(dataDirectory, ".initialized")), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("historical team names cannot be recreated or claimed by another team", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));
    store.createTeam("Green Team", member("leader-c"));
    store.createMatch("Red Dragons", "Blue Escape", 1);
    store.scoreMatch("Red Dragons", "Blue Escape", 4, 2, 1);
    store.disbandTeam("Red Dragons");

    assert.throws(
        () => store.createTeam("red dragons", member("leader-d")),
        error => error instanceof DomainError && /histor|archiv|match|used/i.test(error.message)
    );
    assert.throws(
        () => store.renameTeam("Green Team", "RED DRAGONS"),
        error => error instanceof DomainError && /histor|archiv|match|used/i.test(error.message)
    );

    assert.equal(store.getTeam("Red Dragons"), null);
    assert.equal(store.getTeam("Green Team").leaderId, "leader-c");
    assert.deepEqual(
        store.listMatches(1).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
        [{ team1: "Red Dragons", team2: "Blue Escape", score1: 4, score2: 2 }]
    );
}));

test("renaming a live team does not rewrite its archived match names", () => withStore(store => {
    store.createTeam("Red Dragons", member("leader-a"));
    store.createTeam("Blue Escape", member("leader-b"));
    store.createMatch("Red Dragons", "Blue Escape", 1);
    store.scoreMatch("Red Dragons", "Blue Escape", 4, 2, 1);

    store.renameTeam("Red Dragons", "Crimson Dragons");

    assert.equal(store.getTeam("Crimson Dragons").leaderId, "leader-a");
    assert.deepEqual(
        store.listMatches(1).map(({ team1, team2, score1, score2 }) => ({ team1, team2, score1, score2 })),
        [{ team1: "Red Dragons", team2: "Blue Escape", score1: 4, score2: 2 }]
    );
}));

test("initialized malformed JSON is rejected at startup without being rewritten", () => {
    const cases = [
        {
            relative: "draft.json",
            value: {
                phase: "opne",
                players: [],
                teams: [],
                turnOrder: [],
                currentPick: 0,
                picked: []
            },
            message: /draft\.json|draft phase/i
        },
        {
            relative: "draft.json",
            value: {
                phase: "open",
                players: [],
                teams: [{ name: "Stale Team", leader: "stale-leader" }],
                turnOrder: [],
                currentPick: 0,
                picked: []
            },
            message: /draft\.json|participate|locked/i
        },
        {
            relative: "teams.json",
            value: [{ name: "Broken Team" }],
            message: /teams\.json|leader/i
        }
    ];

    for (const fixtureCase of cases) {
        const fixture = createDataDirectory();
        const filename = path.join(fixture.dataDirectory, fixtureCase.relative);
        writeJson(filename, fixtureCase.value);
        fs.writeFileSync(path.join(fixture.dataDirectory, ".initialized"), "already initialized\n");
        const before = fs.readFileSync(filename, "utf8");
        try {
            assert.throws(() => new LeagueStore(fixture.dataDirectory), fixtureCase.message);
            assert.equal(fs.readFileSync(filename, "utf8"), before);
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    }
});
