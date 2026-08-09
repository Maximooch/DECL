const fs = require("fs");

const teamsFile = "./data/teams.json";

const TEAM_LEADER_ROLE = "759868863109660722";
const MANAGEMENT_ROLE = "740927329345339429";


module.exports = {

    name: "team",
    aliases: ["t"],
    description: "Team commands",


    async execute(message, args) {


        const subcommand = args[0]?.toLowerCase();


        if (!subcommand) {
            return message.reply(
                "Please specify a team command."
            );
        }


        let teams = JSON.parse(
            fs.readFileSync(teamsFile)
        );


        const isManagement =
            message.member.roles.cache.has(
                MANAGEMENT_ROLE
            );


        const isLeader =
            message.member.roles.cache.has(
                TEAM_LEADER_ROLE
            );





        // ==========================
        // !t create <team>
        // Everyone
        // ==========================

        if (subcommand === "create") {


            const teamName =
                args.slice(1).join(" ");


            if (!teamName) {
                return message.reply(
                    "Usage: !t create <team>"
                );
            }



            const exists =
                teams.find(
                    t =>
                    t.name.toLowerCase() ===
                    teamName.toLowerCase()
                );



            if (exists) {
                return message.reply(
                    "❌ That team already exists."
                );
            }



            teams.push({

                name: teamName,

                leader: message.author.id,

                members: [

                    {
                        id: message.author.id,
                        name: message.author.username,
                        role: "leader"
                    }

                ],


                stats: {

                    wins: 0,
                    losses: 0,
                    points: 0

                }

            });



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            await message.member.roles.add(
                TEAM_LEADER_ROLE
            );



            return message.reply(
                `✅ Created **${teamName}** and made you Team Leader.`
            );

        }






        // ==========================
        // !t setleader <team> @user
        // Management only
        // ==========================

        if (subcommand === "setleader") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can change leaders."
                );

            }



            const teamName = args[1];

            const newLeader =
                message.mentions.users.first();



            if (!teamName || !newLeader) {

                return message.reply(
                    "Usage: !t setleader <team> <user>"
                );

            }



            const team =
                teams.find(
                    t =>
                    t.name.toLowerCase() ===
                    teamName.toLowerCase()
                );



            if (!team) {

                return message.reply(
                    "❌ Team not found."
                );

            }



            if (team.leader) {

                const oldLeader =
                    await message.guild.members
                    .fetch(team.leader)
                    .catch(() => null);



                if (oldLeader) {

                    await oldLeader.roles.remove(
                        TEAM_LEADER_ROLE
                    );

                }

            }



            const newMember =
                await message.guild.members
                .fetch(newLeader.id)
                .catch(() => null);



            if (newMember) {

                await newMember.roles.add(
                    TEAM_LEADER_ROLE
                );

            }



            team.leader =
                newLeader.id;



            const existing =
                team.members.find(
                    m =>
                    m.id === newLeader.id
                );



            if (existing) {

                existing.role = "leader";

            } else {

                team.members.push({

                    id: newLeader.id,
                    name: newLeader.username,
                    role: "leader"

                });

            }



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `👑 ${newLeader.username} is now leader of **${team.name}**.`
            );

        }






        // ==========================
        // !t add <player>
        // !t add <player> sub
        // Team Leader only
        // ==========================

        if (subcommand === "add") {


            if (!isLeader && !isManagement) {

                return message.reply(
                    "❌ Only Team Leaders can add players."
                );

            }



            let team;

            let playerName;



            const mentionedUser =
                message.mentions.users.first();



            const role =
                args[2]?.toLowerCase() === "sub"
                ? "substitute"
                : "player";



            // Management:
            // !t add Team Player

            if (isManagement && args.length >= 3) {


                team =
                    teams.find(
                        t =>
                        t.name.toLowerCase() ===
                        args[1].toLowerCase()
                    );



                playerName =
                    mentionedUser
                    ? mentionedUser.username
                    : args.slice(2)
                        .filter(
                            x =>
                            x.toLowerCase() !== "sub"
                        )
                        .join(" ");

            }



            // Leader:
            // !t add Player

            else {


                team =
                    teams.find(
                        t =>
                        t.leader === message.author.id
                    );



                playerName =
                    mentionedUser
                    ? mentionedUser.username
                    : args.slice(1)
                        .filter(
                            x =>
                            x.toLowerCase() !== "sub"
                        )
                        .join(" ");

            }



            if (!team) {

                return message.reply(
                    "❌ Team not found."
                );

            }



            if (!playerName) {

                return message.reply(
                    "Usage: !t add <player>"
                );

            }



            const alreadyOnTeam =
                teams.find(
                    t =>
                    t.members.some(
                        m =>
                        mentionedUser &&
                        m.id === mentionedUser.id
                    )
                );



            if (alreadyOnTeam) {

                return message.reply(
                    `❌ ${playerName} is already on **${alreadyOnTeam.name}**.`
                );

            }
                        const mainPlayers =
                team.members.filter(
                    m =>
                    m.role !== "substitute"
                );


            const substitutes =
                team.members.filter(
                    m =>
                    m.role === "substitute"
                );



            if (role === "player" && mainPlayers.length >= 4) {

                return message.reply(
                    "❌ This team already has 4 main players."
                );

            }



            if (role === "substitute" && substitutes.length >= 2) {

                return message.reply(
                    "❌ This team already has 2 substitutes."
                );

            }



            team.members.push({

                id: mentionedUser
                    ? mentionedUser.id
                    : null,

                name: playerName,

                role: role

            });



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `✅ Added ${playerName} to **${team.name}**.`
            );

        }





        // ==========================
        // !t sub <player>
        // Team Leader only
        // ==========================

        if (subcommand === "sub") {


            if (!isLeader) {

                return message.reply(
                    "❌ Only Team Leaders can use this."
                );

            }



            const team =
                teams.find(
                    t =>
                    t.leader === message.author.id
                );



            const playerName =
                args.slice(1).join(" ");



            if (!team) {

                return message.reply(
                    "❌ You are not a team leader."
                );

            }



            const player =
                team.members.find(
                    m =>
                    m.name.toLowerCase() ===
                    playerName.toLowerCase()
                );



            if (!player) {

                return message.reply(
                    "❌ Player is not on the team."
                );

            }



            const subs =
                team.members.filter(
                    m =>
                    m.role === "substitute"
                );



            if (subs.length >= 2) {

                return message.reply(
                    "❌ This team already has 2 substitutes."
                );

            }



            player.role = "substitute";



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `▪ ${player.name} is now a substitute.`
            );

        }





        // ==========================
        // !t promote <player>
        // Team Leader only
        // ==========================

        if (subcommand === "promote") {


            if (!isLeader) {

                return message.reply(
                    "❌ Only Team Leaders can use this."
                );

            }



            const team =
                teams.find(
                    t =>
                    t.leader === message.author.id
                );



            const playerName =
                args.slice(1).join(" ");



            if (!team) {

                return message.reply(
                    "❌ You are not a team leader."
                );

            }



            const player =
                team.members.find(
                    m =>
                    m.name.toLowerCase() ===
                    playerName.toLowerCase()
                );



            if (!player) {

                return message.reply(
                    "❌ Player is not on the team."
                );

            }



            const mainPlayers =
                team.members.filter(
                    m =>
                    m.role !== "substitute"
                );



            if (mainPlayers.length >= 4) {

                return message.reply(
                    "❌ This team already has 4 main players."
                );

            }



            player.role = "player";



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `▫ ${player.name} is now on the main roster.`
            );

        }





        // ==========================
        // !t leave
        // Everyone
        // ==========================

        if (subcommand === "leave") {


            const team =
                teams.find(
                    t =>
                    t.members.some(
                        m =>
                        m.id === message.author.id
                    )
                );



            if (!team) {

                return message.reply(
                    "❌ You are not on a team."
                );

            }



            const removed =
                team.members.splice(
                    team.members.findIndex(
                        m =>
                        m.id === message.author.id
                    ),
                    1
                )[0];



            // If leader leaves, transfer leadership

            if (removed.role === "leader") {


                const newLeader =
                    team.members[0];



                if (newLeader) {

                    team.leader =
                        newLeader.id;


                    newLeader.role =
                        "leader";



                    const member =
                        await message.guild.members
                        .fetch(newLeader.id)
                        .catch(() => null);



                    if (member) {

                        await member.roles.add(
                            TEAM_LEADER_ROLE
                        );

                    }


                } else {

                    team.leader = null;

                }



                await message.member.roles.remove(
                    TEAM_LEADER_ROLE
                );

            }



            if (team.members.length === 0) {


                const index =
                    teams.findIndex(
                        t =>
                        t.name === team.name
                    );


                teams.splice(
                    index,
                    1
                );


                fs.writeFileSync(
                    teamsFile,
                    JSON.stringify(
                        teams,
                        null,
                        4
                    )
                );


                return message.reply(
                    `✅ You left **${team.name}**. The team was deleted.`
                );

            }



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `✅ You left **${team.name}**.`
            );

        }





        // ==========================
        // !t transfer @user
        // Team Leader only
        // ==========================

        if (subcommand === "transfer") {


            if (!isLeader) {

                return message.reply(
                    "❌ Only Team Leaders can transfer ownership."
                );

            }



            const newLeaderUser =
                message.mentions.users.first();



            if (!newLeaderUser) {

                return message.reply(
                    "Usage: !t transfer @user"
                );

            }



            const team =
                teams.find(
                    t =>
                    t.leader === message.author.id
                );



            if (!team) {

                return message.reply(
                    "❌ You are not a team leader."
                );

            }



            const newLeader =
                team.members.find(
                    m =>
                    m.id === newLeaderUser.id
                );



            if (!newLeader) {

                return message.reply(
                    "❌ That player is not on your team."
                );

            }



            await message.member.roles.remove(
                TEAM_LEADER_ROLE
            );



            const member =
                await message.guild.members
                .fetch(newLeaderUser.id)
                .catch(() => null);



            if (member) {

                await member.roles.add(
                    TEAM_LEADER_ROLE
                );

            }



            const oldLeader =
                team.members.find(
                    m =>
                    m.id === message.author.id
                );



            if (oldLeader) {

                oldLeader.role =
                    "player";

            }



            newLeader.role =
                "leader";



            team.leader =
                newLeaderUser.id;



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `👑 ${newLeaderUser.username} is now leader of **${team.name}**.`
            );

        }





        // ==========================
        // !t remove <player>
        // Team Leader only
        // ==========================

        if (subcommand === "remove") {


            if (!isLeader) {

                return message.reply(
                    "❌ Only Team Leaders can remove players."
                );

            }



            const team =
                teams.find(
                    t =>
                    t.leader === message.author.id
                );



            const playerName =
                args.slice(1).join(" ");



            if (!team) {

                return message.reply(
                    "❌ You are not a team leader."
                );

            }



            const index =
                team.members.findIndex(
                    m =>
                    m.name.toLowerCase() ===
                    playerName.toLowerCase()
                );



            if (index === -1) {

                return message.reply(
                    "❌ That player is not on the team."
                );

            }



            const removed =
                team.members.splice(
                    index,
                    1
                )[0];



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `❌ Removed ${removed.name} from **${team.name}**.`
            );

        }





        // ==========================
        // !t disband <team>
        // Management only
        // ==========================

        if (subcommand === "disband") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can disband teams."
                );

            }



            const teamName =
                args.slice(1).join(" ");



            const index =
                teams.findIndex(
                    t =>
                    t.name.toLowerCase() ===
                    teamName.toLowerCase()
                );



            if (index === -1) {

                return message.reply(
                    "❌ That team does not exist."
                );

            }



            const team =
                teams[index];



            if (team.leader) {

                const leader =
                    await message.guild.members
                    .fetch(team.leader)
                    .catch(() => null);



                if (leader) {

                    await leader.roles.remove(
                        TEAM_LEADER_ROLE
                    );

                }

            }



            teams.splice(
                index,
                1
            );



            fs.writeFileSync(
                teamsFile,
                JSON.stringify(
                    teams,
                    null,
                    4
                )
            );



            return message.reply(
                `🗑️ Disbanded **${team.name}**.`
            );

        }

// ==========================
// !t rename <new team name>
// Team Leader + Management
// ==========================

if (subcommand === "rename") {


    if (!isLeader && !isManagement) {

        return message.reply(
            "❌ Only Team Leaders can rename teams."
        );

    }



    const newName =
        args.slice(1).join(" ");



    if (!newName) {

        return message.reply(
            "Usage: !t rename <new team name>"
        );

    }



    let team;



    // Management can rename any team:
    // !t rename OldTeam NewTeam

    if (isManagement && args.length >= 3) {


        const oldName =
            args[1];


        team =
            teams.find(
                t =>
                t.name.toLowerCase() ===
                oldName.toLowerCase()
            );


    }


    // Team Leader renames their own team

    else {


        team =
            teams.find(
                t =>
                t.leader === message.author.id
            );

    }



    if (!team) {

        return message.reply(
            "❌ Team not found."
        );

    }



    const exists =
        teams.find(
            t =>
            t.name.toLowerCase() ===
            newName.toLowerCase()
        );



    if (exists) {

        return message.reply(
            "❌ A team with that name already exists."
        );

    }



    const oldName =
        team.name;



    team.name =
        newName;



    fs.writeFileSync(
        teamsFile,
        JSON.stringify(
            teams,
            null,
            4
        )
    );



    return message.reply(
        `✅ Renamed **${oldName}** to **${newName}**.`
    );

}



        return message.reply(
            "Unknown team command."
        );

    }

};