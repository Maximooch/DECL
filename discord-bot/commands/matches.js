const fs = require("fs");

const teamsFile = "./data/teams.json";
const tournamentFile = "./data/tournaments/active.json";

module.exports = {
    name: "match",
    description: "Create and update tournament matches",

    async execute(message, args) {
        // !match score Team1 Team2 Score1 Score2
if (args[0]?.toLowerCase() === "score") {

    const team1 = args[1];
    const team2 = args[2];

    const score1 = Number(args[3]);
    const score2 = Number(args[4]);


    if (!team1 || !team2 || isNaN(score1) || isNaN(score2)) {
        return message.reply(
            "Usage: !match score <team1> <team2> <score1> <score2>"
        );
    }


    let activeTournament = JSON.parse(
        fs.readFileSync(tournamentFile)
    );


    const week = activeTournament.week;


    const matchesFile =
        `./data/tournaments/weeks/week${week}.json`;


    let matches = JSON.parse(
        fs.readFileSync(matchesFile)
    );


    const match = matches.find(m =>
        (
            m.team1.toLowerCase() === team1.toLowerCase() &&
            m.team2.toLowerCase() === team2.toLowerCase()
        )
        ||
        (
            m.team1.toLowerCase() === team2.toLowerCase() &&
            m.team2.toLowerCase() === team1.toLowerCase()
        )
    );


    if (!match) {
        return message.reply(
            "❌ Match not found."
        );
    }


    if (match.team1.toLowerCase() === team1.toLowerCase()) {

        match.score1 = score1;
        match.score2 = score2;

    } else {

        match.score1 = score2;
        match.score2 = score1;

    }


    fs.writeFileSync(
        matchesFile,
        JSON.stringify(matches, null, 4)
    );


    return message.reply(
        `✅ Updated ${match.team1} ${match.score1}-${match.score2} ${match.team2}`
    );
}

        if (!args[0]) {
            return message.reply(
                "Usage: !match <team1> <team2>"
            );
        }


        let activeTournament;

        if (fs.existsSync(tournamentFile)) {
            activeTournament = JSON.parse(
                fs.readFileSync(tournamentFile)
            );
        } else {
            return message.reply(
                "❌ No active tournament found."
            );
        }


        const week = activeTournament.week;


        const matchesFile =
            `./data/tournaments/weeks/week${week}.json`;


        if (!fs.existsSync(matchesFile)) {
            fs.writeFileSync(
                matchesFile,
                "[]"
            );
        }


        let matches = JSON.parse(
            fs.readFileSync(matchesFile)
        );



        // !match N64 P3
        const team1 = args[0];
        const team2 = args[1];


        if (!team1 || !team2) {
            return message.reply(
                "Usage: !match <team1> <team2>"
            );
        }



        const teams = JSON.parse(
            fs.readFileSync(teamsFile)
        );


        const exists1 = teams.find(
            t => t.name.toLowerCase() === team1.toLowerCase()
        );


        const exists2 = teams.find(
            t => t.name.toLowerCase() === team2.toLowerCase()
        );


        if (!exists1 || !exists2) {
            return message.reply(
                "❌ One of those teams does not exist."
            );
        }



        matches.push({

            team1: exists1.name,

            team2: exists2.name,

            score1: null,

            score2: null

        });



        fs.writeFileSync(
            matchesFile,
            JSON.stringify(matches, null, 4)
        );



        return message.reply(
            `✅ Match created: **${exists1.name} vs ${exists2.name}**`
        );

    }
};