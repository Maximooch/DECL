const fs = require("fs");

const tournamentFile = "./data/tournaments/active.json";

const MANAGEMENT_ROLE = "1530886306505166910";


module.exports = {
    name: "week",
    description: "Change tournament week",

    execute(message, args) {


        const isManagement =
            message.member.roles.cache.has(MANAGEMENT_ROLE);


        if (!isManagement) {
            return message.reply(
                "❌ Only Management can change weeks."
            );
        }


        if (args[0]?.toLowerCase() !== "start") {
            return message.reply(
                "Usage: !week start <number>"
            );
        }


        const week = Number(args[1]);


        if (!week || week < 1) {
            return message.reply(
                "❌ Please provide a valid week number."
            );
        }


        let tournament = JSON.parse(
            fs.readFileSync(tournamentFile)
        );


        tournament.week = week;


        fs.writeFileSync(
            tournamentFile,
            JSON.stringify(tournament, null, 4)
        );


        return message.reply(
            `✅ Started Week ${week}.`
        );

    }
};