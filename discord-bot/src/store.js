const fs = require("node:fs");
const path = require("node:path");

const TEAM_ROLES = new Set(["leader", "player", "substitute"]);
const DRAFT_PHASES = new Set(["closed", "open", "locked", "drafting", "finished"]);
const MARKER_FILE = ".initialized";
const JOURNAL_FILE = ".pending-transaction.json";
const CORE_FILES = Object.freeze({
    teams: "teams.json",
    players: "players.json",
    draft: "draft.json",
    active: path.join("tournaments", "active.json")
});

const DEFAULT_DRAFT = Object.freeze({
    phase: "closed",
    players: [],
    teams: [],
    turnOrder: [],
    currentPick: 0,
    picked: []
});

class DomainError extends Error {}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function fold(value) {
    return String(value).toLowerCase();
}

class LeagueStore {
    constructor(dataDirectory, seedDirectory = null) {
        if (dataDirectory !== ":memory:" && (typeof dataDirectory !== "string" || !dataDirectory.trim())) {
            throw new TypeError("A data directory is required.");
        }

        this.inMemory = dataDirectory === ":memory:";
        this.memoryFiles = new Map();
        this.memoryImported = false;
        this.tempCounter = 0;

        if (this.inMemory) {
            this.#setMemoryDefaults();
        } else {
            this.dataDirectory = path.resolve(dataDirectory);
            fs.mkdirSync(this.dataDirectory, { recursive: true });
            this.#recoverPendingTransaction();
        }

        if (seedDirectory) this.importLegacyData(seedDirectory);
        if (!this.inMemory) this.#validatePersistedData();
    }

    close() {}

    importLegacyData(seedDirectory) {
        if (this.inMemory) {
            if (this.memoryImported) return false;
            this.#bootstrap(seedDirectory);
            this.memoryImported = true;
            return true;
        }

        this.#recoverPendingTransaction();
        if (fs.existsSync(this.#resolvePath(MARKER_FILE))) return false;
        this.#bootstrap(seedDirectory);
        return true;
    }

    setIgn(discordId, ign) {
        const cleanIgn = String(ign).trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanIgn)) {
            throw new DomainError("Minecraft names must be 3–16 characters using letters, numbers, or underscores.");
        }

        const state = this.#loadCore();
        const claimed = state.players.find(player => player.discordId !== discordId && fold(player.ign) === fold(cleanIgn));
        if (claimed) throw new DomainError("That Minecraft name is already registered.");
        const existing = state.players.find(player => player.discordId === discordId);
        if (existing) existing.ign = cleanIgn;
        else state.players.push({ discordId, ign: cleanIgn });

        const draftPlayer = state.draft.players.find(player => player.id === discordId);
        const changedDraft = Boolean(draftPlayer);
        if (draftPlayer) {
            const duplicate = state.draft.players.find(player => player.id !== discordId && fold(player.ign) === fold(cleanIgn));
            if (duplicate) throw new DomainError("Another player in the draft pool already uses that IGN.");
            draftPlayer.ign = cleanIgn;
        }

        this.#saveCore(state, changedDraft ? ["players", "draft"] : ["players"]);
        return cleanIgn;
    }

    getIgn(discordId) {
        return this.#loadCore().players.find(player => player.discordId === discordId)?.ign;
    }

    createTeam(name, leader) {
        const state = this.#loadCore();
        const cleanName = this.#validateTeamName(name);
        if (state.teams.some(team => fold(team.name) === fold(cleanName))) {
            throw new DomainError("A team with that name already exists.");
        }
        this.#assertHistoricalTeamNameAvailable(cleanName);
        this.#assertUserHasNoTeam(state, leader.id);
        this.#assertNotInDraftPool(state, leader.id);

        const team = {
            name: cleanName,
            leader: leader.id,
            members: [{ id: leader.id, name: leader.displayName, role: "leader" }],
            stats: { wins: 0, losses: 0, points: 0 }
        };
        state.teams.push(team);
        this.#saveCore(state, ["teams"]);
        return this.#hydrateTeam(team, state.teams.length - 1);
    }

    addTeamMember(teamName, member, role = "player") {
        if (!TEAM_ROLES.has(role) || role === "leader") throw new DomainError("Invalid team role.");
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        this.#assertUserHasNoTeam(state, member.id);
        this.#assertNotInDraftPool(state, member.id);
        this.#assertRosterCapacity(state, team, role);
        team.members.push({ id: member.id, name: member.displayName, role });
        this.#saveCore(state, ["teams"]);
        return this.#hydrateTeam(team, index);
    }

    setMemberRole(teamName, discordId, role) {
        if (!new Set(["player", "substitute"]).has(role)) throw new DomainError("Invalid team role.");
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        const member = team.members.find(person => person.id === discordId);
        if (!member) throw new DomainError("That player is not on the team.");
        if (member.role === "leader") throw new DomainError("Transfer leadership before changing the leader's roster role.");
        if (member.role !== role) this.#assertRosterCapacity(state, team, role);
        member.role = role;
        this.#saveCore(state, ["teams"]);
        return this.#hydrateTeam(team, index);
    }

    transferLeadership(teamName, currentLeaderId, newLeader) {
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        if (currentLeaderId && team.leader !== currentLeaderId) throw new DomainError("You do not lead that team.");
        const target = team.members.find(member => member.id === newLeader.id);
        if (!target) throw new DomainError("The new leader must already belong to the team.");
        if (target.id === team.leader) return this.#hydrateTeam(team, index);

        const previousLeaderId = team.leader;
        const previous = team.members.find(member => member.id === previousLeaderId);
        previous.role = target.role === "substitute" ? "substitute" : "player";
        target.role = "leader";
        target.name = newLeader.displayName;
        team.leader = newLeader.id;
        this.#replaceDraftLeader(state.draft, team.name, previousLeaderId, newLeader.id);
        this.#saveCore(state, ["teams", "draft"]);
        return { ...this.#hydrateTeam(team, index), previousLeaderId };
    }

    removeTeamMember(teamName, discordId) {
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        if (team.leader === discordId) throw new DomainError("Transfer leadership before removing the team leader.");
        const memberIndex = team.members.findIndex(member => member.id === discordId);
        if (memberIndex === -1) throw new DomainError("That player is not on the team.");
        team.members.splice(memberIndex, 1);
        this.#saveCore(state, ["teams"]);
        return this.#hydrateTeam(team, index);
    }

    leaveTeam(discordId) {
        const state = this.#loadCore();
        const found = this.#findTeamForUser(state, discordId);
        if (!found) throw new DomainError("You are not on a team.");
        const { team, index } = found;
        const original = this.#hydrateTeam(team, index);

        if (team.leader !== discordId) {
            team.members.splice(team.members.findIndex(member => member.id === discordId), 1);
            this.#saveCore(state, ["teams"]);
            return { deleted: false, team: original, previousLeaderId: null, newLeaderId: null };
        }

        const successor = team.members.find(member => member.id !== discordId);
        if (!successor) {
            this.#assertTeamCanDisappear(state, team);
            state.teams.splice(index, 1);
            this.#saveCore(state, ["teams"]);
            return { deleted: true, team: original, previousLeaderId: discordId, newLeaderId: null };
        }

        team.members.splice(team.members.findIndex(member => member.id === discordId), 1);
        successor.role = "leader";
        team.leader = successor.id;
        this.#replaceDraftLeader(state.draft, team.name, discordId, successor.id);
        this.#saveCore(state, ["teams", "draft"]);
        return {
            deleted: false,
            team: this.#hydrateTeam(team, index),
            previousLeaderId: discordId,
            newLeaderId: successor.id
        };
    }

    renameTeam(teamName, newName) {
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        const cleanName = this.#validateTeamName(newName);
        if (state.teams.some(candidate => candidate !== team && fold(candidate.name) === fold(cleanName))) {
            throw new DomainError("A team with that name already exists.");
        }
        this.#assertHistoricalTeamNameAvailable(cleanName, team.name);

        const oldName = team.name;
        team.name = cleanName;
        for (const draftTeam of state.draft.teams) {
            if (fold(draftTeam.name) === fold(oldName)) draftTeam.name = cleanName;
        }
        for (const pick of state.draft.picked) {
            if (fold(pick.team) === fold(oldName)) pick.team = cleanName;
        }

        const changes = new Map([
            [CORE_FILES.teams, state.teams],
            [CORE_FILES.draft, state.draft]
        ]);

        state.draft = changes.get(CORE_FILES.draft);
        this.#validateCore(state);
        this.#commitValues(changes);
        return this.#hydrateTeam(team, index);
    }

    disbandTeam(teamName) {
        const state = this.#loadCore();
        const { team, index } = this.#requireTeam(state, teamName);
        this.#assertTeamCanDisappear(state, team);
        const result = this.#hydrateTeam(team, index);
        state.teams.splice(index, 1);
        this.#saveCore(state, ["teams"]);
        return result;
    }

    getTeam(identifier) {
        const state = this.#loadCore();
        const found = this.#findTeam(state, identifier);
        return found ? this.#hydrateTeam(found.team, found.index) : null;
    }

    getTeamForUser(discordId) {
        const state = this.#loadCore();
        const found = this.#findTeamForUser(state, discordId);
        return found ? this.#hydrateTeam(found.team, found.index) : null;
    }

    listTeams() {
        const state = this.#loadCore();
        return state.teams
            .map((team, index) => this.#hydrateTeam(team, index))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }

    setActiveWeek(week) {
        const value = this.#validateWeek(week);
        const state = this.#loadCore();
        state.active.week = value;
        this.#saveCore(state, ["active"]);
        return value;
    }

    getActiveWeek() {
        return this.#loadCore().active.week;
    }

    createMatch(team1Name, team2Name, week = this.getActiveWeek()) {
        const value = this.#validateWeek(week);
        const state = this.#loadCore();
        const first = this.#requireTeam(state, team1Name).team;
        const second = this.#requireTeam(state, team2Name).team;
        if (first === second) throw new DomainError("A team cannot play itself.");

        const relative = this.#weekFile(value);
        const matches = this.#readJson(relative, []);
        this.#validateMatches(matches, relative);
        if (matches.some(match => this.#samePair(match, first.name, second.name))) {
            throw new DomainError("That match already exists for this week.");
        }
        matches.push({ team1: first.name, team2: second.name, score1: null, score2: null });
        this.#validateMatches(matches, relative);
        this.#commitValues(new Map([[relative, matches]]));
        return this.#mapMatch(matches.at(-1), matches.length - 1, value);
    }

    scoreMatch(team1Name, team2Name, score1, score2, week = this.getActiveWeek()) {
        const value = this.#validateWeek(week);
        const requested1 = String(team1Name).trim();
        const requested2 = String(team2Name).trim();
        const firstScore = Number(score1);
        const secondScore = Number(score2);
        if (![firstScore, secondScore].every(score => Number.isInteger(score) && score >= 0)) {
            throw new DomainError("Scores must be non-negative integers.");
        }

        const relative = this.#weekFile(value);
        const matches = this.#readJson(relative, []);
        this.#validateMatches(matches, relative);
        const index = matches.findIndex(match => this.#samePair(match, requested1, requested2));
        if (index === -1) throw new DomainError("Match not found.");
        const match = matches[index];
        if (fold(match.team1) === fold(requested1)) {
            match.score1 = firstScore;
            match.score2 = secondScore;
        } else {
            match.score1 = secondScore;
            match.score2 = firstScore;
        }
        this.#validateMatches(matches, relative);
        this.#commitValues(new Map([[relative, matches]]));
        return this.#mapMatch(match, index, value, fold(match.team1) !== fold(requested1));
    }

    getMatch(team1Name, team2Name, week = this.getActiveWeek()) {
        const value = this.#validateWeek(week);
        const requested1 = String(team1Name).trim();
        const requested2 = String(team2Name).trim();
        const relative = this.#weekFile(value);
        const matches = this.#readJson(relative, []);
        this.#validateMatches(matches, relative);
        const index = matches.findIndex(match => this.#samePair(match, requested1, requested2));
        if (index === -1) return null;
        const match = matches[index];
        return this.#mapMatch(match, index, value, fold(match.team1) !== fold(requested1));
    }

    listMatches(week = this.getActiveWeek()) {
        const value = this.#validateWeek(week);
        this.#ensureInitialized();
        const relative = this.#weekFile(value);
        const matches = this.#readJson(relative, []);
        this.#validateMatches(matches, relative);
        return matches.map((match, index) => this.#mapMatch(match, index, value));
    }

    openDraft() {
        const state = this.#loadCore();
        state.draft = this.#emptyDraft("open");
        this.#saveCore(state, ["draft"]);
        return this.#draftState(state);
    }

    lockDraft() {
        const state = this.#loadCore();
        if (state.draft.phase !== "open") throw new DomainError("The draft is not open.");
        state.draft.phase = "locked";
        this.#saveCore(state, ["draft"]);
        return this.#draftState(state);
    }

    stopDraft() {
        const state = this.#loadCore();
        state.draft = this.#emptyDraft("closed");
        this.#saveCore(state, ["draft"]);
        return this.#draftState(state);
    }

    joinDraft(player) {
        const state = this.#loadCore();
        if (state.draft.phase !== "open") throw new DomainError("Draft registration is not open.");
        const cleanIgn = String(player.ign).trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanIgn)) {
            throw new DomainError("Set a valid Minecraft name with `/ign` before joining the draft.");
        }
        if (this.#findTeamForUser(state, player.id)) throw new DomainError("Players already on a team cannot join the draft pool.");
        if (state.draft.players.some(candidate => candidate.id === player.id)) {
            throw new DomainError("You are already in the draft pool.");
        }
        if (state.draft.players.some(candidate => fold(candidate.ign) === fold(cleanIgn))) {
            throw new DomainError("Another player in the draft pool already uses that IGN.");
        }
        state.draft.players.push({ id: player.id, ign: cleanIgn });
        this.#saveCore(state, ["draft"]);
        return this.#draftPool(state);
    }

    joinDraftAsTeam(leaderId) {
        const state = this.#loadCore();
        if (state.draft.phase !== "locked") throw new DomainError("Teams can only join after registration is locked.");
        const found = this.#findTeamForUser(state, leaderId);
        if (!found || found.team.leader !== leaderId) {
            throw new DomainError("Only a team's current leader can enter it in the draft.");
        }
        if (state.draft.teams.some(team => fold(team.name) === fold(found.team.name))) {
            return this.#hydrateTeam(found.team, found.index);
        }
        this.#assertRosterCapacity(state, found.team, "player", { ignoreReservation: true });
        state.draft.teams.push({ name: found.team.name, leader: leaderId });
        this.#saveCore(state, ["draft"]);
        return this.#hydrateTeam(found.team, found.index);
    }

    startDraft(random = Math.random) {
        const state = this.#loadCore();
        if (state.draft.phase !== "locked") throw new DomainError("Lock registration before starting the draft.");
        if (state.draft.teams.length === 0) throw new DomainError("No teams have joined the draft.");
        if (state.draft.players.length < state.draft.teams.length) {
            throw new DomainError("The draft needs at least one available player per participating team.");
        }

        const participants = state.draft.teams.map(participant => {
            const found = this.#requireTeam(state, participant.name);
            if (found.team.leader !== participant.leader) {
                throw new DomainError(`The leader for ${found.team.name} changed; have that team join the draft again.`);
            }
            this.#assertRosterCapacity(state, found.team, "player", { ignoreReservation: true });
            return participant;
        });
        for (let index = participants.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(random() * (index + 1));
            [participants[index], participants[swapIndex]] = [participants[swapIndex], participants[index]];
        }
        state.draft.turnOrder = participants.map(team => team.leader);
        state.draft.currentPick = 0;
        state.draft.picked = [];
        state.draft.phase = "drafting";
        this.#saveCore(state, ["draft"]);
        return this.#draftState(state);
    }

    pickDraftPlayer(leaderId, ign) {
        const state = this.#loadCore();
        if (state.draft.phase !== "drafting") throw new DomainError("The draft is not currently running.");
        const currentLeader = state.draft.turnOrder[state.draft.currentPick];
        if (!currentLeader) throw new DomainError("There is no current pick.");
        if (currentLeader !== leaderId) throw new DomainError("It is not your team's turn.");

        const participant = state.draft.teams.find(team => team.leader === currentLeader);
        if (!participant) throw new DomainError("There is no current pick.");
        const found = this.#requireTeam(state, participant.name);
        if (found.team.leader !== leaderId) throw new DomainError("It is not your team's turn.");
        const playerIndex = state.draft.players.findIndex(player => fold(player.ign) === fold(ign));
        if (playerIndex === -1) throw new DomainError("That player is not available.");
        const player = state.draft.players[playerIndex];
        this.#assertUserHasNoTeam(state, player.id);
        this.#assertRosterCapacity(state, found.team, "player", { ignoreReservation: true });

        found.team.members.push({ id: player.id, name: player.ign, role: "player" });
        state.draft.picked.push({
            pick: state.draft.currentPick + 1,
            player: player.ign,
            id: player.id,
            pickedBy: leaderId,
            team: found.team.name
        });
        state.draft.players.splice(playerIndex, 1);
        state.draft.currentPick += 1;
        if (state.draft.currentPick >= state.draft.turnOrder.length) {
            state.draft.phase = "finished";
        }
        this.#saveCore(state, ["teams", "draft"]);
        return {
            player: { id: player.id, ign: player.ign },
            team: this.#hydrateTeam(found.team, found.index),
            state: this.#draftState(state)
        };
    }

    getDraftState() {
        return this.#draftState(this.#loadCore());
    }

    getDraftPool() {
        return this.#draftPool(this.#loadCore());
    }

    getDraftPicks() {
        const state = this.#loadCore();
        return state.draft.picked
            .map((pick, index) => ({
                position: Number.isInteger(pick.pick) ? pick.pick - 1 : index,
                discordId: pick.id,
                ign: pick.player,
                team: pick.team
            }))
            .sort((a, b) => a.position - b.position);
    }

    #bootstrap(seedDirectory) {
        this.#assertNoUnmigratedDatabase();
        const seed = seedDirectory ? path.resolve(seedDirectory) : null;
        const teams = this.#bootstrapValue(CORE_FILES.teams, seed, []);
        const players = this.#bootstrapValue(CORE_FILES.players, seed, []);
        let draft = this.#bootstrapValue(CORE_FILES.draft, seed, DEFAULT_DRAFT);
        const active = this.#bootstrapValue(CORE_FILES.active, seed, { week: 1 });
        draft = this.#normalizeDraft(draft, teams, { removeRosteredPlayers: true });
        const state = { teams, players, draft, active };
        this.#validateCore(state);

        const changes = new Map([
            [CORE_FILES.teams, teams],
            [CORE_FILES.players, players],
            [CORE_FILES.draft, draft],
            [CORE_FILES.active, active]
        ]);
        const weekFiles = new Set([
            ...this.#listWeekFilesIn(this.inMemory ? null : this.dataDirectory),
            ...this.#listWeekFilesIn(seed)
        ]);
        for (const relative of weekFiles) {
            const matches = this.#bootstrapValue(relative, seed, []);
            this.#validateMatches(matches, relative);
            changes.set(relative, matches);
        }

        if (this.inMemory) {
            this.#commitValues(changes);
            return;
        }
        const contents = this.#serializeValues(changes);
        contents.set(MARKER_FILE, `${new Date().toISOString()}\n`);
        this.#commitContents(contents);
    }

    #bootstrapValue(relative, seedDirectory, fallback) {
        if (!this.inMemory) {
            const target = this.#resolvePath(relative);
            if (fs.existsSync(target)) return this.#readJsonFile(target, relative);
        }
        if (seedDirectory) {
            const source = path.join(seedDirectory, relative);
            if (fs.existsSync(source)) return this.#readJsonFile(source, relative);
        }
        return clone(fallback);
    }

    #ensureInitialized() {
        if (this.inMemory) return;
        this.#recoverPendingTransaction();
        if (!fs.existsSync(this.#resolvePath(MARKER_FILE))) this.#bootstrap(null);
    }

    #loadCore() {
        this.#ensureInitialized();
        const teams = this.#readJson(CORE_FILES.teams);
        const players = this.#readJson(CORE_FILES.players);
        const draft = this.#readJson(CORE_FILES.draft);
        const active = this.#readJson(CORE_FILES.active);
        const state = { teams, players, draft, active };
        this.#validateCore(state);
        return state;
    }

    #saveCore(state, keys) {
        this.#validateCore(state);
        const changes = new Map(keys.map(key => [CORE_FILES[key], state[key]]));
        this.#commitValues(changes);
    }

    #validatePersistedData() {
        this.#loadCore();
        for (const relative of this.#listWeekFiles()) {
            this.#validateMatches(this.#readJson(relative), relative);
        }
    }

    #setMemoryDefaults() {
        this.memoryFiles.set(CORE_FILES.teams, []);
        this.memoryFiles.set(CORE_FILES.players, []);
        this.memoryFiles.set(CORE_FILES.draft, clone(DEFAULT_DRAFT));
        this.memoryFiles.set(CORE_FILES.active, { week: 1 });
    }

    #readJson(relative, fallback) {
        if (this.inMemory) {
            if (this.memoryFiles.has(relative)) return clone(this.memoryFiles.get(relative));
            if (arguments.length > 1) return clone(fallback);
            throw new Error(`Missing league data file: ${relative}.`);
        }
        const filename = this.#resolvePath(relative);
        if (!fs.existsSync(filename)) {
            if (arguments.length > 1) return clone(fallback);
            throw new Error(`Missing league data file: ${filename}. Restore it from ${filename}.bak if available.`);
        }
        return this.#readJsonFile(filename, relative);
    }

    #readJsonFile(filename, label) {
        try {
            return JSON.parse(fs.readFileSync(filename, "utf8"));
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON in ${label}: ${error.message}. Restore the .bak file or correct the edit.`);
            }
            throw error;
        }
    }

    #serializeValues(changes) {
        return new Map([...changes].map(([relative, value]) => [
            relative,
            `${JSON.stringify(value, null, 4)}\n`
        ]));
    }

    #commitValues(changes) {
        if (this.inMemory) {
            for (const [relative, value] of changes) this.memoryFiles.set(relative, clone(value));
            return;
        }
        this.#commitContents(this.#serializeValues(changes));
    }

    #commitContents(contents) {
        if (contents.size === 0) return;
        this.#recoverPendingTransaction();

        for (const [relative] of contents) {
            if (relative === MARKER_FILE) continue;
            const target = this.#resolvePath(relative);
            if (fs.existsSync(target)) {
                this.#atomicReplace(`${target}.bak`, fs.readFileSync(target));
            }
        }

        const journal = {
            version: 1,
            writes: [...contents].map(([relative, content]) => ({ relative, content }))
        };
        this.#atomicReplace(this.#resolvePath(JOURNAL_FILE), `${JSON.stringify(journal, null, 4)}\n`);
        for (const [relative, content] of contents) {
            this.#atomicReplace(this.#resolvePath(relative), content);
        }
        fs.unlinkSync(this.#resolvePath(JOURNAL_FILE));
        this.#syncDirectory(this.dataDirectory);
    }

    #recoverPendingTransaction() {
        if (this.inMemory) return;
        const filename = this.#resolvePath(JOURNAL_FILE);
        if (!fs.existsSync(filename)) return;
        const journal = this.#readJsonFile(filename, JOURNAL_FILE);
        if (journal?.version !== 1 || !Array.isArray(journal.writes)) {
            throw new Error(`Invalid pending transaction journal: ${filename}.`);
        }
        for (const write of journal.writes) {
            if (!write || typeof write.relative !== "string" || typeof write.content !== "string") {
                throw new Error(`Invalid pending transaction journal: ${filename}.`);
            }
            this.#atomicReplace(this.#resolvePath(write.relative), write.content);
        }
        fs.unlinkSync(filename);
        this.#syncDirectory(this.dataDirectory);
    }

    #atomicReplace(filename, contents) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        const temporary = `${filename}.tmp-${process.pid}-${this.tempCounter += 1}`;
        let descriptor;
        try {
            descriptor = fs.openSync(temporary, "wx", 0o644);
            fs.writeFileSync(descriptor, contents);
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temporary, filename);
            this.#syncDirectory(path.dirname(filename));
        } finally {
            if (descriptor !== undefined) fs.closeSync(descriptor);
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }

    #syncDirectory(directory) {
        let descriptor;
        try {
            descriptor = fs.openSync(directory, "r");
            fs.fsyncSync(descriptor);
        } catch (error) {
            if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)) throw error;
        } finally {
            if (descriptor !== undefined) fs.closeSync(descriptor);
        }
    }

    #resolvePath(relative) {
        if (path.isAbsolute(relative)) throw new Error("League data paths must be relative.");
        const filename = path.resolve(this.dataDirectory, relative);
        const prefix = `${this.dataDirectory}${path.sep}`;
        if (filename !== this.dataDirectory && !filename.startsWith(prefix)) {
            throw new Error("League data path escapes the configured data directory.");
        }
        return filename;
    }

    #listWeekFiles() {
        if (this.inMemory) {
            return [...this.memoryFiles.keys()]
                .filter(relative => /^tournaments[\\/]weeks[\\/]week\d+\.json$/.test(relative))
                .sort();
        }
        return this.#listWeekFilesIn(this.dataDirectory);
    }

    #listWeekFilesIn(directory) {
        if (!directory) return [];
        const weeksDirectory = path.join(directory, "tournaments", "weeks");
        if (!fs.existsSync(weeksDirectory)) return [];
        return fs.readdirSync(weeksDirectory, { withFileTypes: true })
            .filter(entry => entry.isFile() && /^week\d+\.json$/.test(entry.name))
            .map(entry => path.join("tournaments", "weeks", entry.name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    #weekFile(week) {
        return path.join("tournaments", "weeks", `week${week}.json`);
    }

    #validateCore(state) {
        this.#validateTeams(state.teams);
        this.#validatePlayers(state.players);
        if (!state.active || typeof state.active !== "object" || Array.isArray(state.active)) {
            throw new Error("Invalid tournaments/active.json: expected an object.");
        }
        this.#validateWeek(state.active.week, false);
        this.#validateDraft(state.draft, state.teams);
    }

    #validateTeams(teams) {
        if (!Array.isArray(teams)) throw new Error("Invalid teams.json: expected an array.");
        const names = new Set();
        const members = new Set();
        for (const team of teams) {
            if (!team || typeof team !== "object" || typeof team.name !== "string" || !team.name.trim()) {
                throw new Error("Invalid teams.json: every team needs a name.");
            }
            if (team.name.trim().replace(/\s+/g, " ") !== team.name || team.name.length < 2 || team.name.length > 40) {
                throw new Error(`Invalid teams.json: ${team.name} must be a normalized 2–40 character name.`);
            }
            if (names.has(fold(team.name))) throw new Error(`Invalid teams.json: duplicate team name ${team.name}.`);
            names.add(fold(team.name));
            if (typeof team.leader !== "string" || !team.leader) {
                throw new Error(`Invalid teams.json: ${team.name} needs a leader Discord ID.`);
            }
            if (!Array.isArray(team.members)) throw new Error(`Invalid teams.json: ${team.name} needs a members array.`);
            let leaderCount = 0;
            let mainCount = 0;
            let substituteCount = 0;
            for (const member of team.members) {
                if (!member || typeof member.id !== "string" || !member.id || typeof member.name !== "string" || !TEAM_ROLES.has(member.role)) {
                    throw new Error(`Invalid teams.json: ${team.name} has an invalid member.`);
                }
                if (members.has(member.id)) throw new Error(`Invalid teams.json: Discord user ${member.id} belongs to multiple teams.`);
                members.add(member.id);
                if (member.role === "leader") {
                    leaderCount += 1;
                    if (member.id !== team.leader) throw new Error(`Invalid teams.json: ${team.name}'s leader fields disagree.`);
                }
                if (member.role === "substitute") substituteCount += 1;
                else mainCount += 1;
            }
            if (leaderCount !== 1) throw new Error(`Invalid teams.json: ${team.name} must have exactly one leader.`);
            if (mainCount > 4 || substituteCount > 2) throw new Error(`Invalid teams.json: ${team.name} exceeds roster limits.`);
            if (!team.stats || ![team.stats.wins, team.stats.losses, team.stats.points].every(Number.isFinite)) {
                throw new Error(`Invalid teams.json: ${team.name} needs numeric wins, losses, and points.`);
            }
        }
    }

    #validatePlayers(players) {
        if (!Array.isArray(players)) throw new Error("Invalid players.json: expected an array.");
        const ids = new Set();
        const igns = new Set();
        for (const player of players) {
            if (!player || typeof player.discordId !== "string" || !player.discordId
                || typeof player.ign !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(player.ign)) {
                throw new Error("Invalid players.json: every player needs discordId and ign strings.");
            }
            if (ids.has(player.discordId)) throw new Error(`Invalid players.json: duplicate Discord ID ${player.discordId}.`);
            if (igns.has(fold(player.ign))) throw new Error(`Invalid players.json: duplicate IGN ${player.ign}.`);
            ids.add(player.discordId);
            igns.add(fold(player.ign));
        }
    }

    #validateDraft(draft, teams) {
        if (!draft || typeof draft !== "object" || Array.isArray(draft) || !DRAFT_PHASES.has(draft.phase)) {
            throw new Error("Invalid draft.json: unknown draft phase.");
        }
        for (const key of ["players", "teams", "turnOrder", "picked"]) {
            if (!Array.isArray(draft[key])) throw new Error(`Invalid draft.json: ${key} must be an array.`);
        }
        if (!Number.isInteger(draft.currentPick) || draft.currentPick < 0) {
            throw new Error("Invalid draft.json: currentPick must be a non-negative integer.");
        }

        const rosterIds = new Set(teams.flatMap(team => team.members.map(member => member.id)));
        const poolIds = new Set();
        const poolIgns = new Set();
        for (const player of draft.players) {
            if (!player || typeof player.id !== "string" || !player.id
                || typeof player.ign !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(player.ign)) {
                throw new Error("Invalid draft.json: every pool player needs id and ign strings.");
            }
            if (poolIds.has(player.id) || poolIgns.has(fold(player.ign))) {
                throw new Error("Invalid draft.json: duplicate draft player or IGN.");
            }
            if (rosterIds.has(player.id)) throw new Error(`Invalid draft.json: rostered player ${player.id} is still in the draft pool.`);
            poolIds.add(player.id);
            poolIgns.add(fold(player.ign));
        }

        const participantNames = new Set();
        const participantLeaders = new Set();
        for (const participant of draft.teams) {
            if (!participant || typeof participant.name !== "string" || typeof participant.leader !== "string") {
                throw new Error("Invalid draft.json: invalid participating team.");
            }
            if (participantNames.has(fold(participant.name)) || participantLeaders.has(participant.leader)) {
                throw new Error("Invalid draft.json: duplicate participating team or leader.");
            }
            participantNames.add(fold(participant.name));
            participantLeaders.add(participant.leader);
            if (["locked", "drafting"].includes(draft.phase)) {
                const current = teams.find(team => fold(team.name) === fold(participant.name));
                if (!current || current.leader !== participant.leader) {
                    throw new Error(`Invalid draft.json: ${participant.name} no longer matches a current team leader.`);
                }
            }
        }
        if (draft.turnOrder.some(leader => !participantLeaders.has(leader))) {
            throw new Error("Invalid draft.json: turnOrder contains a non-participating leader.");
        }
        if (new Set(draft.turnOrder).size !== draft.turnOrder.length) {
            throw new Error("Invalid draft.json: turnOrder contains duplicate leaders.");
        }
        if (["closed", "open", "locked"].includes(draft.phase) && (draft.currentPick !== 0 || draft.picked.length !== 0)) {
            throw new Error("Invalid draft.json: picks exist before the draft started.");
        }
        if (["closed", "open"].includes(draft.phase) && (draft.teams.length !== 0 || draft.turnOrder.length !== 0)) {
            throw new Error("Invalid draft.json: teams cannot participate before registration is locked.");
        }
        if (draft.phase === "closed" && draft.players.length !== 0) {
            throw new Error("Invalid draft.json: a closed draft cannot retain registered players.");
        }
        if (draft.phase === "locked" && draft.turnOrder.length !== 0) {
            throw new Error("Invalid draft.json: a locked draft cannot have a turn order yet.");
        }
        if (["drafting", "finished"].includes(draft.phase) && draft.turnOrder.length !== draft.teams.length) {
            throw new Error("Invalid draft.json: every participating team needs one draft turn.");
        }
        if (draft.picked.length !== draft.currentPick) {
            throw new Error("Invalid draft.json: pick history and currentPick disagree.");
        }
        if (draft.phase === "drafting" && draft.currentPick >= draft.turnOrder.length) {
            throw new Error("Invalid draft.json: drafting has no remaining turn.");
        }
        if (draft.phase === "finished" && draft.currentPick !== draft.turnOrder.length) {
            throw new Error("Invalid draft.json: finished draft has remaining turns.");
        }
        const pickedIds = new Set();
        for (let index = 0; index < draft.picked.length; index += 1) {
            const pick = draft.picked[index];
            if (!pick || pick.pick !== index + 1 || typeof pick.player !== "string" || typeof pick.id !== "string"
                || typeof pick.pickedBy !== "string" || typeof pick.team !== "string") {
                throw new Error("Invalid draft.json: invalid pick history.");
            }
            if (pickedIds.has(pick.id) || poolIds.has(pick.id)) throw new Error("Invalid draft.json: duplicate picked player.");
            pickedIds.add(pick.id);
        }
    }

    #validateMatches(matches, label) {
        if (!Array.isArray(matches)) throw new Error(`Invalid ${label}: expected an array.`);
        const pairs = new Set();
        for (const match of matches) {
            if (!match || typeof match.team1 !== "string" || !match.team1 || typeof match.team2 !== "string" || !match.team2) {
                throw new Error(`Invalid ${label}: every match needs two team names.`);
            }
            if (fold(match.team1) === fold(match.team2)) throw new Error(`Invalid ${label}: a team cannot play itself.`);
            const scoresValid = (match.score1 === null && match.score2 === null)
                || [match.score1, match.score2].every(score => Number.isInteger(score) && score >= 0);
            if (!scoresValid) throw new Error(`Invalid ${label}: scores must both be null or non-negative integers.`);
            const pair = [fold(match.team1), fold(match.team2)].sort().join("\u0000");
            if (pairs.has(pair)) throw new Error(`Invalid ${label}: duplicate match ${match.team1} vs ${match.team2}.`);
            pairs.add(pair);
        }
    }

    #normalizeDraft(input, teams, { removeRosteredPlayers = false } = {}) {
        const source = input && typeof input === "object" && !Array.isArray(input) ? clone(input) : {};
        const phase = DRAFT_PHASES.has(source.phase) ? source.phase : "closed";
        const draft = {
            phase,
            players: Array.isArray(source.players) ? source.players : [],
            teams: Array.isArray(source.teams) ? source.teams : [],
            turnOrder: Array.isArray(source.turnOrder) ? source.turnOrder : [],
            currentPick: Number.isInteger(source.currentPick) ? source.currentPick : 0,
            picked: Array.isArray(source.picked) ? source.picked.map((pick, index) => ({
                ...pick,
                pick: Number.isInteger(pick?.pick) ? pick.pick : index + 1
            })) : []
        };

        if (removeRosteredPlayers) {
            const rosterIds = new Set(teams.flatMap(team => (team.members || []).map(member => member.id)));
            draft.players = draft.players.filter(player => !rosterIds.has(player.id));
        }
        if (phase === "closed") return this.#emptyDraft("closed");
        if (phase === "open") {
            draft.teams = [];
            draft.turnOrder = [];
            draft.currentPick = 0;
            draft.picked = [];
        }
        if (phase === "locked") {
            draft.turnOrder = [];
            draft.currentPick = 0;
            draft.picked = [];
        }
        return draft;
    }

    #emptyDraft(phase) {
        return { ...clone(DEFAULT_DRAFT), phase };
    }

    #findTeam(state, identifier) {
        if (typeof identifier === "number" || typeof identifier === "bigint") {
            const index = Number(identifier) - 1;
            return Number.isSafeInteger(index) && state.teams[index] ? { team: state.teams[index], index } : null;
        }
        const index = state.teams.findIndex(team => fold(team.name) === fold(identifier));
        return index === -1 ? null : { team: state.teams[index], index };
    }

    #requireTeam(state, identifier) {
        const found = this.#findTeam(state, identifier);
        if (!found) throw new DomainError("Team not found.");
        return found;
    }

    #findTeamForUser(state, discordId) {
        const index = state.teams.findIndex(team => team.members.some(member => member.id === discordId));
        return index === -1 ? null : { team: state.teams[index], index };
    }

    #validateTeamName(name) {
        const cleanName = String(name).trim().replace(/\s+/g, " ");
        if (cleanName.length < 2 || cleanName.length > 40) throw new DomainError("Team names must be 2–40 characters.");
        return cleanName;
    }

    #assertHistoricalTeamNameAvailable(name, currentName = null) {
        if (currentName && fold(name) === fold(currentName)) return;
        for (const relative of this.#listWeekFiles()) {
            const matches = this.#readJson(relative);
            this.#validateMatches(matches, relative);
            if (matches.some(match => fold(match.team1) === fold(name) || fold(match.team2) === fold(name))) {
                throw new DomainError("That team name is reserved by archived match history.");
            }
        }
    }

    #assertNoUnmigratedDatabase() {
        if (this.inMemory) return;
        const database = this.#resolvePath("decl.sqlite");
        if (fs.existsSync(database)) {
            throw new Error(
                `Found existing SQLite league data at ${database}. `
                + "This version uses JSON and will not replace or ignore that database. "
                + "Back it up and export it before moving it out of DATA_DIR."
            );
        }
    }

    #validateWeek(week, domainError = true) {
        const value = Number(week);
        if (!Number.isInteger(value) || value < 1) {
            if (domainError) throw new DomainError("Week must be a positive integer.");
            throw new Error("Invalid tournaments/active.json: week must be a positive integer.");
        }
        return value;
    }

    #assertUserHasNoTeam(state, discordId) {
        const found = this.#findTeamForUser(state, discordId);
        if (found) throw new DomainError(`That player is already on ${found.team.name}.`);
    }

    #assertNotInDraftPool(state, discordId) {
        if (state.draft.players.some(player => player.id === discordId)) {
            throw new DomainError("That player is registered in the draft pool. Stop the draft before adding them to a team.");
        }
    }

    #assertRosterCapacity(state, team, role, { ignoreReservation = false } = {}) {
        const count = role === "substitute"
            ? team.members.filter(member => member.role === "substitute").length
            : team.members.filter(member => member.role !== "substitute").length;
        const limit = role === "substitute" ? 2 : 4;
        if (count >= limit) {
            throw new DomainError(`The team already has ${limit} ${role === "substitute" ? "substitutes" : "main-roster players"}.`);
        }
        if (role !== "substitute" && !ignoreReservation && this.#hasPendingDraftPick(state, team) && count >= limit - 1) {
            throw new DomainError("The team must keep one main-roster spot open for its draft pick.");
        }
    }

    #hasPendingDraftPick(state, team) {
        if (!["locked", "drafting"].includes(state.draft.phase)) return false;
        const participating = state.draft.teams.some(candidate => fold(candidate.name) === fold(team.name));
        const alreadyPicked = state.draft.picked.some(pick => fold(pick.team) === fold(team.name));
        return participating && !alreadyPicked;
    }

    #assertTeamCanDisappear(state, team) {
        if (["locked", "drafting"].includes(state.draft.phase)
            && state.draft.teams.some(candidate => fold(candidate.name) === fold(team.name))) {
            throw new DomainError("Stop or finish the draft before disbanding a participating team.");
        }
    }

    #replaceDraftLeader(draft, teamName, previousLeaderId, newLeaderId) {
        const participant = draft.teams.find(team => fold(team.name) === fold(teamName));
        if (!participant) return;
        participant.leader = newLeaderId;
        draft.turnOrder = draft.turnOrder.map(leader => leader === previousLeaderId ? newLeaderId : leader);
    }

    #hydrateTeam(team, index) {
        const order = { leader: 0, player: 1, substitute: 2 };
        const members = team.members
            .map(member => ({ discordId: member.id, displayName: member.name, role: member.role }))
            .sort((a, b) => order[a.role] - order[b.role]
                || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
        return {
            id: index + 1,
            name: team.name,
            leaderId: team.leader,
            wins: team.stats.wins,
            losses: team.stats.losses,
            points: team.stats.points,
            members
        };
    }

    #samePair(match, team1, team2) {
        return (fold(match.team1) === fold(team1) && fold(match.team2) === fold(team2))
            || (fold(match.team1) === fold(team2) && fold(match.team2) === fold(team1));
    }

    #mapMatch(match, index, week, reverse = false) {
        return {
            id: index + 1,
            week,
            team1: reverse ? match.team2 : match.team1,
            team2: reverse ? match.team1 : match.team2,
            score1: reverse ? match.score2 : match.score1,
            score2: reverse ? match.score1 : match.score2
        };
    }

    #draftState(state) {
        const currentLeaderId = state.draft.turnOrder[state.draft.currentPick] || null;
        const currentTeam = currentLeaderId
            ? state.draft.teams.find(team => team.leader === currentLeaderId)?.name || null
            : null;
        return {
            phase: state.draft.phase,
            currentPick: state.draft.currentPick,
            currentLeaderId,
            currentTeam
        };
    }

    #draftPool(state) {
        return state.draft.players
            .map(player => ({ discordId: player.id, ign: player.ign }))
            .sort((a, b) => a.ign.localeCompare(b.ign, undefined, { sensitivity: "base" }));
    }
}

module.exports = { LeagueStore, DomainError };
