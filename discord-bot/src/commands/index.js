const { createBasicCommands } = require("./basic");
const { createTeamCommand } = require("./team");
const { createDraftCommand } = require("./draft");
const { createTournamentCommands } = require("./tournament");

function createCommands(dependencies) {
    return [
        ...createBasicCommands(dependencies),
        createTeamCommand(dependencies),
        createDraftCommand(dependencies),
        ...createTournamentCommands(dependencies)
    ];
}

module.exports = { createCommands };
