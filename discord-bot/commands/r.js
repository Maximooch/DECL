const fs = require("fs");

const teamsFile = "./data/teams.json";
const playersFile = "./data/players.json";

module.exports = {
    name: "r",
    description: "Display a team's roster",

    execute(message, args) {

        let teamName = args.join(" ");

        let teams = JSON.parse(
            fs.readFileSync(teamsFile)
        );


        // Load linked IGN data
        let players = [];

        if (fs.existsSync(playersFile)) {
            players = JSON.parse(
                fs.readFileSync(playersFile)
            );
        }


        // !r with no arguments = show your own team
        if (!teamName) {

            const userTeam = teams.find(team =>
                team.members.some(member =>
                    member.id === message.author.id
                )
            );


            if (!userTeam) {
                return message.reply(
                    "❌ You are not currently on a team."
                );
            }


            teamName = userTeam.name;
        }



        const team = teams.find(
    t => t.name?.toLowerCase() === teamName.toLowerCase()
);


        if (!team) {
            return message.reply(
                "That team does not exist."
            );
        }



        let members = "";



        // Leader → Main roster → Subs
        const sortedMembers = [...team.members].sort((a, b) => {

            const priority = {
                leader: 0,
                player: 1,
                substitute: 2
            };


            return priority[a.role] - priority[b.role];
        });



        sortedMembers.forEach(member => {

            let icon = "▫";


            if (member.role === "leader") {
                icon = "👑";
            }


            if (member.role === "substitute") {
                icon = "▪";
            }



            // Default to stored name
            let displayName = member.name;



            // Replace with linked IGN if available
            if (member.id) {

                const linkedPlayer = players.find(
                    p => p.discordId === member.id
                );


                if (linkedPlayer) {
                    displayName = linkedPlayer.ign;
                }
            }



            members += `${icon} ${displayName}\n`;
        });



        if (!members) {
            members = "No members yet.";
        }



        const stats = team.stats || {
            wins: 0,
            losses: 0,
            points: 0
        };



        const embed = {
            title: team.name,
            description:
`**Members:**
${members}

**League Stats:**
Points: ${stats.points >= 0 ? "+" : ""}${stats.points}
Record: ${stats.wins}W - ${stats.losses}L`
        };



        message.reply({
            embeds: [embed]
        });
    }
};