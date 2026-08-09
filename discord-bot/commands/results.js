const fs = require("fs");

const tournamentFile = "./data/tournaments/active.json";


module.exports = {
    name: "results",
    description: "Display tournament results",

    execute(message, args) {


        let activeTournament = JSON.parse(
            fs.readFileSync(tournamentFile)
        );


        const week = activeTournament.week;


        const matchesFile =
            `./data/tournaments/weeks/week${week}.json`;



        if (!fs.existsSync(matchesFile)) {
            return message.reply(
                "❌ No matches have been played this week."
            );
        }



        let matches = JSON.parse(
            fs.readFileSync(matchesFile)
        );



        if (matches.length === 0) {
            return message.reply(
                "❌ No matches found."
            );
        }



        let output =
`🏆 **Week ${week} Results**

`;



        matches.forEach(match => {

            let score = "TBD";


            if (
                match.score1 !== null &&
                match.score2 !== null
            ) {
                score =
                `${match.score1}-${match.score2}`;
            }



            output +=
`${match.team1} | ${score} | ${match.team2}
`;

        });



        message.reply(output);

    }
};