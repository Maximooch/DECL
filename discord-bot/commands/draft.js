const fs = require("fs");
const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");


const draftFile = "./data/draft.json";
const playersFile = "./data/players.json";
const teamsFile = "./data/teams.json";


const MANAGEMENT_ROLE = "740927329345339429";
const TEAM_LEADER_ROLE = "759868863109660722";



function saveDraft(draft) {

    fs.writeFileSync(
        draftFile,
        JSON.stringify(draft, null, 4)
    );

}



function loadJSON(file) {

    if (!fs.existsSync(file)) {
        return [];
    }

    return JSON.parse(
        fs.readFileSync(file)
    );

}



module.exports = {


    name: "draft",


    data: new SlashCommandBuilder()

        .setName("draft")

        .setDescription("Draft commands")

        .addSubcommand(sub =>
            sub
                .setName("join")
                .setDescription("Join the draft pool")
        )

        .addSubcommand(sub =>
            sub
                .setName("pick")
                .setDescription("Pick a player during the draft")
                .addStringOption(option =>
                    option
                        .setName("player")
                        .setDescription("Player IGN")
                        .setRequired(true)
                )
        ),



    async execute(input, args) {


        let draft = JSON.parse(
            fs.readFileSync(draftFile)
        );



        /*
            ==========================
            SLASH COMMANDS
            ==========================
        */


        if (
            typeof input.isChatInputCommand === "function" &&
            input.isChatInputCommand()
        ) {


            const subcommand =
                input.options.getSubcommand();



            /*
                /draft join
            */


            if (subcommand === "join") {


                const userId =
                    input.user.id;



                if (draft.phase !== "open") {

                    return input.reply({

                        content:
                            "❌ Draft registration is not currently open.",

                        ephemeral: true

                    });

                }



                const alreadyJoined =
                    draft.players.find(
                        p => p.id === userId
                    );



                if (alreadyJoined) {

                    return input.reply({

                        content:
                            "❌ You are already in the draft pool.",

                        ephemeral: true

                    });

                }



                const teams =
                    loadJSON(teamsFile);



                const existingTeam =
                    teams.find(team =>
                        team.members.some(
                            member =>
                                member.id === userId
                        )
                    );



                if (existingTeam) {

                    return input.reply({

                        content:
                            `❌ You are already on team **${existingTeam.name}**.`,

                        ephemeral: true

                    });

                }



                const players =
                    loadJSON(playersFile);



                const playerData =
                    players.find(
                        p =>
                            p.discordId === userId
                    );



                const ign =
                    playerData
                        ? playerData.ign
                        : input.user.username;



                draft.players.push({

                    id: userId,

                    ign: ign

                });



                saveDraft(draft);



                return input.reply({

                    content:
                        `✅ You joined the draft pool as **${ign}**.`,

                    ephemeral: true

                });

            }

                        /*
                /draft pick
            */


            if (subcommand === "pick") {


                const userId =
                    input.user.id;



                if (draft.phase !== "drafting") {

                    return input.reply({

                        content:
                            "❌ The draft has not started yet.",

                        ephemeral: true

                    });

                }



                const currentLeader =
                    draft.turnOrder[draft.currentPick];



                if (!currentLeader) {

                    return input.reply({

                        content:
                            "❌ There is no current pick.",

                        ephemeral: true

                    });

                }



                if (currentLeader !== userId) {

                    return input.reply({

                        content:
                            "❌ It is not your team's turn.",

                        ephemeral: true

                    });

                }



                const pickedName =
                    input.options.getString("player");



                const playerIndex =
                    draft.players.findIndex(
                        p =>
                            p.ign.toLowerCase() ===
                            pickedName.toLowerCase()
                    );



                if (playerIndex === -1) {

                    return input.reply({

                        content:
                            "❌ That player is not available.",

                        ephemeral: true

                    });

                }



                // Find the team belonging to the person picking

const teams =
    loadJSON(teamsFile);


const pickingTeam =
    teams.find(
        team =>
            team.leader === userId
    );



if (!pickingTeam) {

    return input.reply({

        content:
            "❌ You are not assigned to a team.",

        ephemeral: true

    });

}



// Save the pick history

draft.picked.push({

    pick:
        draft.picked.length + 1,

    player:
        player.ign,

    id:
        player.id,

    pickedBy:
        userId,

    team:
        pickingTeam.name

});



                draft.players.splice(
                    playerIndex,
                    1
                );



                draft.currentPick++;



                saveDraft(draft);



                const nextLeader =
                    draft.turnOrder[draft.currentPick];



                if (!nextLeader) {

                    draft.phase =
                        "finished";

                    saveDraft(draft);



                    return input.reply({

                        content:
                            `✅ You selected **${player.ign}**.\n\n🏁 Draft has finished.`,

                        ephemeral: true

                    });

                }



                return input.reply({

                    content:
                        `✅ You selected **${player.ign}**.\n\nThe next team is now picking.`,

                    ephemeral: true

                });

            }



            return;

        }





        /*
            ==========================
            PREFIX COMMANDS
            ==========================
        */


        const message = input;



        const subcommand =
            args[0]?.toLowerCase();



        if (!subcommand) {

            return message.reply(
                "Usage: !draft <open|lock|start|stop|join|list|view>"
            );

        }



        const isManagement =
            message.member.roles.cache.has(
                MANAGEMENT_ROLE
            );


        const isLeader =
            message.member.roles.cache.has(
                TEAM_LEADER_ROLE
            );





        /*
            !draft open
        */


        if (subcommand === "open") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can open the draft."
                );

            }



            draft.active = true;

            draft.phase = "open";

            draft.players = [];

            draft.picked = [];

            draft.turnOrder = [];

            draft.currentPick = 0;



            saveDraft(draft);



            return message.reply(
                "✅ Draft registration is now open!\n\nPlayers can join using:\n/draft join"
            );

        }





        /*
            !draft lock
        */


        if (subcommand === "lock") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can lock the draft."
                );

            }



            if (draft.phase !== "open") {

                return message.reply(
                    "❌ The draft is not currently open."
                );

            }



            draft.phase =
                "locked";


            draft.active =
                false;



            saveDraft(draft);



            const buttonRow =
                new ActionRowBuilder()
                    .addComponents(

                        new ButtonBuilder()
                            .setCustomId("draft_join")
                            .setLabel("Join Draft")
                            .setStyle(ButtonStyle.Success),

                        new ButtonBuilder()
                            .setCustomId("draft_decline")
                            .setLabel("Decline")
                            .setStyle(ButtonStyle.Danger)

                    );



            return message.reply({

                content:
                    `<@&${TEAM_LEADER_ROLE}>\n\n✅ Draft registration has been locked.\n\nTeam leaders, choose whether your team wants to participate.`,

                components:
                    [buttonRow]

            });

        }

                /*
            !draft start
        */


        if (subcommand === "start") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can start the draft."
                );

            }



            if (draft.phase !== "locked") {

                return message.reply(
                    "❌ The draft must be locked before starting."
                );

            }



            if (!draft.teams || draft.teams.length === 0) {

                return message.reply(
                    "❌ No teams have joined the draft."
                );

            }



            // Randomize team leader order

            draft.turnOrder =
                [...draft.teams]
                    .sort(() => Math.random() - 0.5)
                    .map(team => team.leader);



            draft.currentPick = 0;

            draft.phase =
                "drafting";

            draft.active =
                true;



            saveDraft(draft);



            const firstLeader =
                draft.turnOrder[0];



            return message.reply(
                `✅ Draft has started!\n\nFirst pick: <@${firstLeader}>`
            );

        }





        /*
            !draft stop
        */


        if (subcommand === "stop") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can stop the draft."
                );

            }



            draft.active = false;

            draft.phase = "closed";

            draft.players = [];

            draft.teams = [];

            draft.leaders = [];

            draft.turnOrder = [];

            draft.currentPick = 0;

            draft.picked = [];



            saveDraft(draft);



            return message.reply(
                "✅ Draft has been stopped and reset."
            );

        }





        /*
            !draft join
        */


        if (subcommand === "join") {


            if (draft.phase !== "open") {

                return message.reply(
                    "❌ Draft registration is not open."
                );

            }



            const alreadyJoined =
                draft.players.find(
                    p =>
                        p.id === message.author.id
                );



            if (alreadyJoined) {

                return message.reply(
                    "❌ You are already in the draft pool."
                );

            }



            const teams =
                loadJSON(teamsFile);



            const existingTeam =
                teams.find(team =>
                    team.members.some(
                        member =>
                            member.id === message.author.id
                    )
                );



            if (existingTeam) {

                return message.reply(
                    `❌ You are already on team **${existingTeam.name}** and cannot join the draft.`
                );

            }



            const players =
                loadJSON(playersFile);



            const playerData =
                players.find(
                    p =>
                        p.discordId === message.author.id
                );



            const ign =
                playerData
                    ? playerData.ign
                    : message.author.username;



            draft.players.push({

                id: message.author.id,

                ign: ign

            });



            saveDraft(draft);



            return message.reply(
                `✅ You joined the draft pool as **${ign}**.`
            );

        }





        /*
            !draft list
            Management only
        */


        if (subcommand === "list") {


            if (!isManagement) {

                return message.reply(
                    "❌ Only Management can view the draft list."
                );

            }



            if (draft.players.length === 0) {

                return message.reply(
                    "The draft pool is empty."
                );

            }



            let list = "";



            draft.players.forEach(
                (player, index) => {

                    list +=
                    `${index + 1}. ${player.ign}\n`;

                }
            );



            return message.reply(
                `🏆 Draft Pool\n\n${list}`
            );

        }

                /*
            /*
    !draft view
    Leaders + Management
    Only available after lock
*/

if (subcommand === "view") {


    if (!isLeader && !isManagement) {

        return message.reply(
            "❌ Only Team Leaders can view the draft pool."
        );

    }



    if (
        draft.phase !== "locked" &&
        draft.phase !== "drafting" &&
        draft.phase !== "finished"
    ) {

        return message.reply(
            "❌ The draft pool is not available yet. Team Leaders can view players after the draft has been locked."
        );

    }



    if (draft.players.length === 0) {

        return message.reply(
            "The draft pool is empty."
        );

    }



    let list = "";



    draft.players.forEach(
        (player, index) => {

            list +=
            `${index + 1}. ${player.ign}\n`;

        }
    );



    return message.reply(
        `🏆 Available Draft Players\n\n${list}`
    );

}
        return message.reply(
            "Unknown draft command."
        );

    }

};