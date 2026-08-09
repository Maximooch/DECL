# DECL Discord bot

The DECL bot manages Minecraft identities, league teams, player drafts, tournament weeks, matches, and results. It uses Discord slash commands and stores runtime state transactionally in SQLite.

## Requirements

- Node.js 22 or newer, or Docker
- A Discord application and bot token
- Two Discord roles: league management and team leader
- The bot's Discord role must have **Manage Roles** and be positioned above the Team Leader role

Only the non-privileged `Guilds` gateway intent is used. Message Content and Guild Members intents are not required.

## Local setup

```bash
cp .env.example .env
npm ci
npm run deploy:commands
npm start
```

Fill in these environment variables before registering commands or starting the bot:

| Variable | Purpose |
| --- | --- |
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application ID |
| `GUILD_ID` | Server where commands are registered |
| `MANAGEMENT_ROLE_ID` | Role allowed to administer drafts, weeks, and matches |
| `TEAM_LEADER_ROLE_ID` | Role assigned to team leaders |
| `DATA_DIR` | Persistent state directory; defaults to `./runtime` locally and `/data` in Docker |
| `DATABASE_PATH` | Optional SQLite path override |

Startup fails with a concise list when required configuration is missing. Never commit `.env`.

## Commands

- `/ign`, `/roster`, `/teams`, `/help`, `/ping`
- `/team create|add|substitute|promote|remove|transfer|leave|rename|setleader|disband`
- `/draft join|participate|pick|view|status|open|lock|start|stop`
- `/match create|score`, `/results`, `/week`

Team and match names are Discord string options, so names containing spaces work normally. Management-only operations verify `MANAGEMENT_ROLE_ID` at execution time.

## SQLite and legacy data

The first startup creates `decl.sqlite` in `DATA_DIR`. When the database has no teams, the bot imports the included legacy JSON players, teams, current week, matches, and open draft pool once. All later writes go to SQLite. SQLite WAL mode, foreign keys, uniqueness constraints, and transactions protect team and draft invariants.

Back up the entire data directory. Do not scale this bot beyond one container while using SQLite.

## Coolify deployment

1. Create a Coolify application from this repository and set the base directory to `/discord-bot`.
2. Select the included `Dockerfile` build pack.
3. Add every required environment variable in Coolify. Use the rotated token, not the token from the original archive.
4. Add persistent storage mounted at `/data`. Without this volume, a redeploy loses the SQLite database.
5. Deploy the application.
6. Open the application terminal once and run `npm run deploy:commands` whenever command definitions change.

The container runs as the unprivileged `node` user and includes a heartbeat health check. A public domain or exposed port is unnecessary because Discord initiates the gateway connection outbound.

## Development

```bash
npm test
npm run test:watch
```

Tests use temporary SQLite databases and do not contact Discord.
