const fs = require("fs");

const teamsFile = "./data/teams.json";

module.exports = {
    name: "teams",
    aliases: ["league"],
    description: "Display all teams",

    execute(message, args) {

        let teams = JSON.parse(fs.readFileSync(teamsFile));

        if (teams.length === 0) {
            return message.reply("There are no teams registered.");
        }


        let list = "";

        teams.forEach((team, index) => {

            const memberCount = team.members.length;

            list +=
`${index + 1}. **${team.name}**
${memberCount}/6 Members

`;
        });


        const embed = {
            title: "🏆 Dragon Escape League",
            description: list
        };


        message.reply({ embeds: [embed] });
    }
};