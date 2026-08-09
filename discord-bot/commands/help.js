const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");


const MANAGEMENT_ROLE = "740927329345339429";
const TEAM_LEADER_ROLE = "759868863109660722";


module.exports = {

    name: "help",


    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("View available commands"),



    async execute(interaction) {


        const member = interaction.member;


        const DECL_EMOJI =
            interaction.guild.emojis.cache.find(
                emoji => emoji.name === "DECL"
            );



        const isManagement =
            member.roles.cache.has(
                MANAGEMENT_ROLE
            );


        const isTeamLeader =
            member.roles.cache.has(
                TEAM_LEADER_ROLE
            );



        const embed =
            new EmbedBuilder()

            .setTitle(
                `DECL Commands ${DECL_EMOJI ? DECL_EMOJI.toString() : ""}`
            )

            .setDescription(
`
**Commands**

\`!r\`
View your own team roster

\`!r <team>\`
View a specific team's roster

\`!teams\`
View all tournament teams

\`/ign <name>\`
Set your Minecraft IGN

\`/draft join\`
Join the draft pool

\`/results\`
View tournament results

\`/help\`
View this command list
`
            );



        if (isTeamLeader || isManagement) {


            embed.addFields({

                name: "━━━━━━━━━━━━━━━━━━━━\nTeam Leader Commands",

                value:
`
\`!t create <team>\`
Create a team and become Team Leader

\`!t add <player>\`
Add a player to your team

\`!t remove <player>\`
Remove a player from your team

\`!t sub <player>\`
Add a substitute

\`!t promote <player>\`
Promote a substitute

\`!t transfer @user\`
Transfer team ownership

\`!t leave\`
Leave your current team

\`/draft view\`
View available draft players

\`/draft pick <player>\`
Pick a draft player
`

            });

        }




        if (isManagement) {


            embed.addFields({

                name: "━━━━━━━━━━━━━━━━━━━━\nManagement Commands",

                value:
`
\`!draft open\`
Open draft registration

\`!draft lock\`
Lock draft registration

\`!draft start\`
Start the draft

\`!draft stop\`
Stop the draft

\`!draft list\`
View draft status

\`!t disband <team>\`
Disband a team

\`!match <team1> <team2>\`
Create a match

\`!match win <team>\`
Record match winner
`

            });

        }



        embed.setFooter({

            text: "DECL Tournament Bot"

        });



        await interaction.reply({

            embeds: [embed],

            ephemeral: true

        });


    }

};