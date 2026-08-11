const path = require("node:path");

const REQUIRED_VARIABLES = [
    "TOKEN",
    "CLIENT_ID",
    "GUILD_ID",
    "MANAGEMENT_ROLE_ID",
    "TEAM_LEADER_ROLE_ID"
];

function loadConfig(environment = process.env) {
    const missing = REQUIRED_VARIABLES.filter(key => !environment[key]?.trim());

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }

    const dataDirectory = path.resolve(environment.DATA_DIR || "./data");

    return Object.freeze({
        token: environment.TOKEN,
        clientId: environment.CLIENT_ID,
        guildId: environment.GUILD_ID,
        managementRoleId: environment.MANAGEMENT_ROLE_ID,
        teamLeaderRoleId: environment.TEAM_LEADER_ROLE_ID,
        dataDirectory
    });
}

module.exports = { loadConfig, REQUIRED_VARIABLES };
