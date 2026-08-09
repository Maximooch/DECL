const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const TEAM_ROLES = new Set(["leader", "player", "substitute"]);
const DRAFT_PHASES = new Set(["closed", "open", "locked", "drafting", "finished"]);

class DomainError extends Error {}

class LeagueStore {
    constructor(databasePath) {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        this.db = new Database(databasePath);
        this.db.pragma("foreign_keys = ON");
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("busy_timeout = 5000");
        this.#migrate();
    }

    close() {
        this.db.close();
    }

    #migrate() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS players (
                discord_id TEXT PRIMARY KEY,
                ign TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                leader_id TEXT NOT NULL,
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                points INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS team_members (
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                discord_id TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('leader', 'player', 'substitute')),
                PRIMARY KEY (team_id, discord_id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week INTEGER NOT NULL CHECK (week > 0),
                team1_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                team2_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                score1 INTEGER CHECK (score1 >= 0),
                score2 INTEGER CHECK (score2 >= 0),
                CHECK (team1_id < team2_id),
                UNIQUE (week, team1_id, team2_id)
            );

            CREATE TABLE IF NOT EXISTS draft_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                phase TEXT NOT NULL CHECK (phase IN ('closed', 'open', 'locked', 'drafting', 'finished')),
                current_pick INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS draft_pool (
                discord_id TEXT PRIMARY KEY,
                ign TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS draft_teams (
                team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS draft_turns (
                position INTEGER PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                leader_id TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS draft_picks (
                position INTEGER PRIMARY KEY,
                discord_id TEXT NOT NULL,
                ign TEXT NOT NULL,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE
            );

            INSERT OR IGNORE INTO settings (key, value) VALUES ('active_week', '1');
            INSERT OR IGNORE INTO draft_state (id, phase, current_pick) VALUES (1, 'closed', 0);
        `);
    }

    importLegacyData(dataDirectory) {
        const hasData = this.db.prepare("SELECT EXISTS(SELECT 1 FROM teams) AS found").get().found;
        if (hasData) return false;

        const readJson = (relativePath, fallback) => {
            const filename = path.join(dataDirectory, relativePath);
            return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : fallback;
        };

        const players = readJson("players.json", []);
        const teams = readJson("teams.json", []);
        const activeTournament = readJson(path.join("tournaments", "active.json"), { week: 1 });
        const draft = readJson("draft.json", null);

        this.db.transaction(() => {
            const insertPlayer = this.db.prepare("INSERT OR IGNORE INTO players (discord_id, ign) VALUES (?, ?)");
            for (const player of players) {
                if (player.discordId && player.ign) insertPlayer.run(player.discordId, player.ign);
            }

            for (const team of teams) {
                if (!team.name || !team.leader) continue;
                const result = this.db.prepare(`
                    INSERT INTO teams (name, leader_id, wins, losses, points)
                    VALUES (?, ?, ?, ?, ?)
                `).run(team.name, team.leader, team.stats?.wins || 0, team.stats?.losses || 0, team.stats?.points || 0);

                const insertMember = this.db.prepare(`
                    INSERT OR IGNORE INTO team_members (team_id, discord_id, display_name, role)
                    VALUES (?, ?, ?, ?)
                `);
                for (const member of team.members || []) {
                    if (!member.id || !TEAM_ROLES.has(member.role)) continue;
                    insertMember.run(result.lastInsertRowid, member.id, member.name || member.id, member.role);
                }
            }

            this.setActiveWeek(Number(activeTournament.week) || 1);

            const matches = readJson(path.join("tournaments", "weeks", `week${this.getActiveWeek()}.json`), []);
            for (const match of matches) {
                try {
                    this.createMatch(match.team1, match.team2, this.getActiveWeek());
                    if (match.score1 !== null && match.score2 !== null) {
                        this.scoreMatch(match.team1, match.team2, match.score1, match.score2, this.getActiveWeek());
                    }
                } catch (error) {
                    if (!(error instanceof DomainError)) throw error;
                }
            }

            if (draft && DRAFT_PHASES.has(draft.phase)) {
                const importablePhase = ["open", "closed"].includes(draft.phase) ? draft.phase : "closed";
                this.db.prepare("UPDATE draft_state SET phase = ?, current_pick = ? WHERE id = 1")
                    .run(importablePhase, 0);
                const insertPool = this.db.prepare("INSERT OR IGNORE INTO draft_pool (discord_id, ign) VALUES (?, ?)");
                for (const player of draft.players || []) {
                    if (player.id && player.ign) insertPool.run(player.id, player.ign);
                }
            }
        })();

        return true;
    }

    setIgn(discordId, ign) {
        const cleanIgn = ign.trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanIgn)) {
            throw new DomainError("Minecraft names must be 3–16 characters using letters, numbers, or underscores.");
        }
        this.db.prepare(`
            INSERT INTO players (discord_id, ign) VALUES (?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET ign = excluded.ign
        `).run(discordId, cleanIgn);
        return cleanIgn;
    }

    getIgn(discordId) {
        return this.db.prepare("SELECT ign FROM players WHERE discord_id = ?").get(discordId)?.ign;
    }

    createTeam(name, leader) {
        return this.db.transaction(() => {
            const cleanName = this.#validateTeamName(name);
            this.#assertUserHasNoTeam(leader.id);
            let result;
            try {
                result = this.db.prepare("INSERT INTO teams (name, leader_id) VALUES (?, ?)").run(cleanName, leader.id);
            } catch (error) {
                if (error.code?.startsWith("SQLITE_CONSTRAINT")) throw new DomainError("A team with that name already exists.");
                throw error;
            }
            this.db.prepare(`
                INSERT INTO team_members (team_id, discord_id, display_name, role)
                VALUES (?, ?, ?, 'leader')
            `).run(result.lastInsertRowid, leader.id, leader.displayName);
            return this.getTeam(cleanName);
        })();
    }

    addTeamMember(teamName, member, role = "player") {
        if (!TEAM_ROLES.has(role) || role === "leader") throw new DomainError("Invalid team role.");
        return this.db.transaction(() => {
            const team = this.#requireTeam(teamName);
            this.#assertUserHasNoTeam(member.id);
            this.#assertRosterCapacity(team.id, role);
            this.db.prepare(`
                INSERT INTO team_members (team_id, discord_id, display_name, role)
                VALUES (?, ?, ?, ?)
            `).run(team.id, member.id, member.displayName, role);
            return this.getTeam(team.id);
        })();
    }

    setMemberRole(teamName, discordId, role) {
        if (!new Set(["player", "substitute"]).has(role)) throw new DomainError("Invalid team role.");
        return this.db.transaction(() => {
            const team = this.#requireTeam(teamName);
            const member = this.db.prepare("SELECT * FROM team_members WHERE team_id = ? AND discord_id = ?").get(team.id, discordId);
            if (!member) throw new DomainError("That player is not on the team.");
            if (member.role === "leader") throw new DomainError("Transfer leadership before changing the leader's roster role.");
            if (member.role !== role) this.#assertRosterCapacity(team.id, role);
            this.db.prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND discord_id = ?")
                .run(role, team.id, discordId);
            return this.getTeam(team.id);
        })();
    }

    transferLeadership(teamName, currentLeaderId, newLeader) {
        return this.db.transaction(() => {
            const team = this.#requireTeam(teamName);
            if (currentLeaderId && team.leaderId !== currentLeaderId) throw new DomainError("You do not lead that team.");
            const target = this.db.prepare("SELECT * FROM team_members WHERE team_id = ? AND discord_id = ?").get(team.id, newLeader.id);
            if (!target) throw new DomainError("The new leader must already belong to the team.");
            if (target.discord_id === team.leaderId) return team;
            if (target.role === "substitute") this.#assertRosterCapacity(team.id, "player");
            this.db.prepare("UPDATE team_members SET role = 'player' WHERE team_id = ? AND discord_id = ?")
                .run(team.id, team.leaderId);
            this.db.prepare("UPDATE team_members SET role = 'leader', display_name = ? WHERE team_id = ? AND discord_id = ?")
                .run(newLeader.displayName, team.id, newLeader.id);
            this.db.prepare("UPDATE teams SET leader_id = ? WHERE id = ?").run(newLeader.id, team.id);
            return { ...this.getTeam(team.id), previousLeaderId: team.leaderId };
        })();
    }

    removeTeamMember(teamName, discordId) {
        return this.db.transaction(() => {
            const team = this.#requireTeam(teamName);
            if (team.leaderId === discordId) throw new DomainError("Transfer leadership before removing the team leader.");
            const result = this.db.prepare("DELETE FROM team_members WHERE team_id = ? AND discord_id = ?").run(team.id, discordId);
            if (result.changes === 0) throw new DomainError("That player is not on the team.");
            return this.getTeam(team.id);
        })();
    }

    leaveTeam(discordId) {
        return this.db.transaction(() => {
            const team = this.getTeamForUser(discordId);
            if (!team) throw new DomainError("You are not on a team.");
            if (team.leaderId !== discordId) {
                this.db.prepare("DELETE FROM team_members WHERE team_id = ? AND discord_id = ?").run(team.id, discordId);
                return { deleted: false, team, previousLeaderId: null, newLeaderId: null };
            }

            const successor = team.members.find(member => member.discordId !== discordId);
            this.db.prepare("DELETE FROM team_members WHERE team_id = ? AND discord_id = ?").run(team.id, discordId);
            if (!successor) {
                this.db.prepare("DELETE FROM teams WHERE id = ?").run(team.id);
                return { deleted: true, team, previousLeaderId: discordId, newLeaderId: null };
            }
            this.db.prepare("UPDATE teams SET leader_id = ? WHERE id = ?").run(successor.discordId, team.id);
            this.db.prepare("UPDATE team_members SET role = 'leader' WHERE team_id = ? AND discord_id = ?")
                .run(team.id, successor.discordId);
            return { deleted: false, team: this.getTeam(team.id), previousLeaderId: discordId, newLeaderId: successor.discordId };
        })();
    }

    renameTeam(teamName, newName) {
        const team = this.#requireTeam(teamName);
        const cleanName = this.#validateTeamName(newName);
        try {
            this.db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(cleanName, team.id);
        } catch (error) {
            if (error.code?.startsWith("SQLITE_CONSTRAINT")) throw new DomainError("A team with that name already exists.");
            throw error;
        }
        return this.getTeam(team.id);
    }

    disbandTeam(teamName) {
        const team = this.#requireTeam(teamName);
        this.db.prepare("DELETE FROM teams WHERE id = ?").run(team.id);
        return team;
    }

    getTeam(identifier) {
        const row = typeof identifier === "number" || typeof identifier === "bigint"
            ? this.db.prepare("SELECT * FROM teams WHERE id = ?").get(identifier)
            : this.db.prepare("SELECT * FROM teams WHERE name = ? COLLATE NOCASE").get(identifier);
        if (!row) return null;
        return this.#hydrateTeam(row);
    }

    getTeamForUser(discordId) {
        const row = this.db.prepare(`
            SELECT teams.* FROM teams
            JOIN team_members ON team_members.team_id = teams.id
            WHERE team_members.discord_id = ?
        `).get(discordId);
        return row ? this.#hydrateTeam(row) : null;
    }

    listTeams() {
        return this.db.prepare("SELECT * FROM teams ORDER BY name COLLATE NOCASE").all().map(row => this.#hydrateTeam(row));
    }

    setActiveWeek(week) {
        const value = Number(week);
        if (!Number.isInteger(value) || value < 1) throw new DomainError("Week must be a positive integer.");
        this.db.prepare("UPDATE settings SET value = ? WHERE key = 'active_week'").run(String(value));
        return value;
    }

    getActiveWeek() {
        return Number(this.db.prepare("SELECT value FROM settings WHERE key = 'active_week'").get().value);
    }

    createMatch(team1Name, team2Name, week = this.getActiveWeek()) {
        const team1 = this.#requireTeam(team1Name);
        const team2 = this.#requireTeam(team2Name);
        if (team1.id === team2.id) throw new DomainError("A team cannot play itself.");
        const [first, second] = team1.id < team2.id ? [team1, team2] : [team2, team1];
        try {
            this.db.prepare("INSERT INTO matches (week, team1_id, team2_id) VALUES (?, ?, ?)")
                .run(week, first.id, second.id);
        } catch (error) {
            if (error.code?.startsWith("SQLITE_CONSTRAINT")) throw new DomainError("That match already exists for this week.");
            throw error;
        }
        return this.getMatch(first.name, second.name, week);
    }

    scoreMatch(team1Name, team2Name, score1, score2, week = this.getActiveWeek()) {
        const requested1 = this.#requireTeam(team1Name);
        const requested2 = this.#requireTeam(team2Name);
        const firstScore = Number(score1);
        const secondScore = Number(score2);
        if (![firstScore, secondScore].every(value => Number.isInteger(value) && value >= 0)) {
            throw new DomainError("Scores must be non-negative integers.");
        }
        const [first, second, normalized1, normalized2] = requested1.id < requested2.id
            ? [requested1, requested2, firstScore, secondScore]
            : [requested2, requested1, secondScore, firstScore];
        const result = this.db.prepare(`
            UPDATE matches SET score1 = ?, score2 = ?
            WHERE week = ? AND team1_id = ? AND team2_id = ?
        `).run(normalized1, normalized2, week, first.id, second.id);
        if (result.changes === 0) throw new DomainError("Match not found.");
        return this.getMatch(requested1.name, requested2.name, week);
    }

    getMatch(team1Name, team2Name, week = this.getActiveWeek()) {
        const requested1 = this.#requireTeam(team1Name);
        const requested2 = this.#requireTeam(team2Name);
        const [first, second] = requested1.id < requested2.id ? [requested1, requested2] : [requested2, requested1];
        const match = this.db.prepare(`
            SELECT matches.*, a.name AS team1_name, b.name AS team2_name
            FROM matches
            JOIN teams a ON a.id = matches.team1_id
            JOIN teams b ON b.id = matches.team2_id
            WHERE week = ? AND team1_id = ? AND team2_id = ?
        `).get(week, first.id, second.id);
        if (!match) return null;
        return requested1.id === first.id ? this.#mapMatch(match) : {
            ...this.#mapMatch(match),
            team1: match.team2_name,
            team2: match.team1_name,
            score1: match.score2,
            score2: match.score1
        };
    }

    listMatches(week = this.getActiveWeek()) {
        return this.db.prepare(`
            SELECT matches.*, a.name AS team1_name, b.name AS team2_name
            FROM matches
            JOIN teams a ON a.id = matches.team1_id
            JOIN teams b ON b.id = matches.team2_id
            WHERE week = ? ORDER BY matches.id
        `).all(week).map(row => this.#mapMatch(row));
    }

    openDraft() {
        this.#resetDraft("open");
        return this.getDraftState();
    }

    lockDraft() {
        const state = this.getDraftState();
        if (state.phase !== "open") throw new DomainError("The draft is not open.");
        this.db.prepare("UPDATE draft_state SET phase = 'locked' WHERE id = 1").run();
        return this.getDraftState();
    }

    stopDraft() {
        this.#resetDraft("closed");
        return this.getDraftState();
    }

    joinDraft(player) {
        return this.db.transaction(() => {
            if (this.getDraftState().phase !== "open") throw new DomainError("Draft registration is not open.");
            if (this.getTeamForUser(player.id)) throw new DomainError("Players already on a team cannot join the draft pool.");
            try {
                this.db.prepare("INSERT INTO draft_pool (discord_id, ign) VALUES (?, ?)").run(player.id, player.ign);
            } catch (error) {
                if (error.code?.startsWith("SQLITE_CONSTRAINT")) throw new DomainError("You are already in the draft pool.");
                throw error;
            }
            return this.getDraftPool();
        })();
    }

    joinDraftAsTeam(leaderId) {
        if (this.getDraftState().phase !== "locked") throw new DomainError("Teams can only join after registration is locked.");
        const team = this.getTeamForUser(leaderId);
        if (!team || team.leaderId !== leaderId) throw new DomainError("Only a team's current leader can enter it in the draft.");
        this.db.prepare("INSERT OR IGNORE INTO draft_teams (team_id) VALUES (?)").run(team.id);
        return team;
    }

    startDraft(random = Math.random) {
        return this.db.transaction(() => {
            if (this.getDraftState().phase !== "locked") throw new DomainError("Lock registration before starting the draft.");
            const teams = this.db.prepare(`
                SELECT teams.* FROM draft_teams JOIN teams ON teams.id = draft_teams.team_id
            `).all();
            if (teams.length === 0) throw new DomainError("No teams have joined the draft.");
            const playerCount = this.db.prepare("SELECT COUNT(*) AS count FROM draft_pool").get().count;
            if (playerCount < teams.length) throw new DomainError("The draft needs at least one available player per participating team.");
            for (let index = teams.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(random() * (index + 1));
                [teams[index], teams[swapIndex]] = [teams[swapIndex], teams[index]];
            }
            this.db.prepare("DELETE FROM draft_turns").run();
            const insertTurn = this.db.prepare("INSERT INTO draft_turns (position, team_id, leader_id) VALUES (?, ?, ?)");
            teams.forEach((team, index) => insertTurn.run(index, team.id, team.leader_id));
            this.db.prepare("UPDATE draft_state SET phase = 'drafting', current_pick = 0 WHERE id = 1").run();
            return this.getDraftState();
        })();
    }

    pickDraftPlayer(leaderId, ign) {
        return this.db.transaction(() => {
            const state = this.getDraftState();
            if (state.phase !== "drafting") throw new DomainError("The draft is not currently running.");
            const turn = this.db.prepare("SELECT * FROM draft_turns WHERE position = ?").get(state.currentPick);
            if (!turn) throw new DomainError("There is no current pick.");
            if (turn.leader_id !== leaderId) throw new DomainError("It is not your team's turn.");
            const player = this.db.prepare("SELECT * FROM draft_pool WHERE ign = ? COLLATE NOCASE").get(ign);
            if (!player) throw new DomainError("That player is not available.");
            this.#assertUserHasNoTeam(player.discord_id);
            this.#assertRosterCapacity(turn.team_id, "player");
            this.db.prepare(`
                INSERT INTO team_members (team_id, discord_id, display_name, role)
                VALUES (?, ?, ?, 'player')
            `).run(turn.team_id, player.discord_id, player.ign);
            this.db.prepare("INSERT INTO draft_picks (position, discord_id, ign, team_id) VALUES (?, ?, ?, ?)")
                .run(state.currentPick, player.discord_id, player.ign, turn.team_id);
            this.db.prepare("DELETE FROM draft_pool WHERE discord_id = ?").run(player.discord_id);
            const nextPick = state.currentPick + 1;
            const hasNext = this.db.prepare("SELECT 1 FROM draft_turns WHERE position = ?").get(nextPick);
            this.db.prepare("UPDATE draft_state SET current_pick = ?, phase = ? WHERE id = 1")
                .run(nextPick, hasNext ? "drafting" : "finished");
            return {
                player: { id: player.discord_id, ign: player.ign },
                team: this.getTeam(turn.team_id),
                state: this.getDraftState()
            };
        })();
    }

    getDraftState() {
        const state = this.db.prepare("SELECT phase, current_pick FROM draft_state WHERE id = 1").get();
        const currentTurn = this.db.prepare(`
            SELECT draft_turns.*, teams.name AS team_name FROM draft_turns
            JOIN teams ON teams.id = draft_turns.team_id
            WHERE position = ?
        `).get(state.current_pick);
        return {
            phase: state.phase,
            currentPick: state.current_pick,
            currentLeaderId: currentTurn?.leader_id || null,
            currentTeam: currentTurn?.team_name || null
        };
    }

    getDraftPool() {
        return this.db.prepare("SELECT discord_id AS discordId, ign FROM draft_pool ORDER BY ign COLLATE NOCASE").all();
    }

    getDraftPicks() {
        return this.db.prepare(`
            SELECT draft_picks.position, draft_picks.discord_id AS discordId,
                   draft_picks.ign, teams.name AS team
            FROM draft_picks JOIN teams ON teams.id = draft_picks.team_id
            ORDER BY draft_picks.position
        `).all();
    }

    #resetDraft(phase) {
        this.db.transaction(() => {
            this.db.prepare("DELETE FROM draft_picks").run();
            this.db.prepare("DELETE FROM draft_turns").run();
            this.db.prepare("DELETE FROM draft_teams").run();
            this.db.prepare("DELETE FROM draft_pool").run();
            this.db.prepare("UPDATE draft_state SET phase = ?, current_pick = 0 WHERE id = 1").run(phase);
        })();
    }

    #requireTeam(identifier) {
        const team = this.getTeam(identifier);
        if (!team) throw new DomainError("Team not found.");
        return team;
    }

    #validateTeamName(name) {
        const cleanName = name.trim().replace(/\s+/g, " ");
        if (cleanName.length < 2 || cleanName.length > 40) throw new DomainError("Team names must be 2–40 characters.");
        return cleanName;
    }

    #assertUserHasNoTeam(discordId) {
        const team = this.getTeamForUser(discordId);
        if (team) throw new DomainError(`That player is already on ${team.name}.`);
    }

    #assertRosterCapacity(teamId, role) {
        const members = this.db.prepare("SELECT role FROM team_members WHERE team_id = ?").all(teamId);
        const count = role === "substitute"
            ? members.filter(member => member.role === "substitute").length
            : members.filter(member => member.role !== "substitute").length;
        const limit = role === "substitute" ? 2 : 4;
        if (count >= limit) throw new DomainError(`The team already has ${limit} ${role === "substitute" ? "substitutes" : "main-roster players"}.`);
    }

    #hydrateTeam(row) {
        const members = this.db.prepare(`
            SELECT discord_id AS discordId, display_name AS displayName, role
            FROM team_members WHERE team_id = ?
            ORDER BY CASE role WHEN 'leader' THEN 0 WHEN 'player' THEN 1 ELSE 2 END, display_name COLLATE NOCASE
        `).all(row.id);
        return {
            id: row.id,
            name: row.name,
            leaderId: row.leader_id,
            wins: row.wins,
            losses: row.losses,
            points: row.points,
            members
        };
    }

    #mapMatch(row) {
        return {
            id: row.id,
            week: row.week,
            team1: row.team1_name,
            team2: row.team2_name,
            score1: row.score1,
            score2: row.score2
        };
    }
}

module.exports = { LeagueStore, DomainError };
