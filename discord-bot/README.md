# DECL Discord bot

The DECL bot manages Minecraft identities, league teams, player drafts, tournament weeks, matches, and results. It uses Discord slash commands and keeps runtime state in human-readable JSON files.

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
| `DATA_DIR` | Optional state directory; defaults to `./data` locally and `/data` in Docker |

Startup fails with a concise list when required configuration is missing. Never commit `.env`.

## Commands

- `/ign`, `/roster`, `/teams`, `/help`, `/ping`
- `/team create|add|substitute|promote|remove|transfer|leave|rename|setleader|disband`
- `/draft join|participate|pick|view|status|open|lock|start|stop`
- `/match create|score`, `/results`, `/week`

Team and match names are Discord string options, so names containing spaces work normally. Management-only operations verify `MANAGEMENT_ROLE_ID` at execution time.

## JSON data

The bot keeps teams, players, drafts, the active week, and weekly matches under `DATA_DIR`. Local development uses the tracked `data/` directory. A new Docker volume is seeded from those files once; after that, `/data` is the live source of truth.

Partners may edit `teams.json` directly, but stop the bot first and keep the existing shape. Startup validates unique team names and members, exactly one matching leader, and roster limits. Team names retained in archived matches cannot be reused through bot commands. Writes replace files atomically and keep the previous version beside each file as `*.bak`; draft picks use a small recovery journal so `teams.json` and `draft.json` stay in sync.

In Coolify, edit `/data/teams.json`, not the copy bundled into the image. The bundled `data/teams.json` is only the seed for a brand-new volume. Back up the entire data directory and run only one bot container.

If startup finds an older `decl.sqlite` in `DATA_DIR`, it stops instead of silently replacing that state. Back up and export the database before moving it out of `DATA_DIR`; a fresh JSON deployment does not require this step.

## Coolify deployment

1. Create a Coolify application from this repository and set the base directory to `/discord-bot`.
2. Select the included `Dockerfile` build pack.
3. Add every required environment variable in Coolify. Use the rotated token, not the token from the original archive.
4. Add persistent storage mounted at `/data`. Without this volume, a redeploy loses the live JSON files.
5. Deploy the application.
6. Open the application terminal once and run `npm run deploy:commands` whenever command definitions change.

The container runs as the unprivileged `node` user and includes a heartbeat health check. A public domain or exposed port is unnecessary because Discord initiates the gateway connection outbound.

## Development

```bash
npm test
npm run test:watch
```

Tests use temporary JSON directories and do not contact Discord.
