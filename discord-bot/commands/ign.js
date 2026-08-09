const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs");

const playersFile = "./data/players.json";


module.exports = {

    // !ign command
    name: "ign",

    // /ign command
    data: new SlashCommandBuilder()
        .setName("ign")
        .setDescription("Set your Minecraft IGN")
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription("Your Minecraft IGN")
                .setRequired(true)
        ),


    async execute(input, args) {


        let ign;
        let discordId;
        let isSlash = false;



        // ==========================
        // Slash command: /ign
        // ==========================

        if (
            typeof input.isChatInputCommand === "function" &&
            input.isChatInputCommand()
        ) {

            isSlash = true;

            ign = input.options.getString("name");

            discordId = input.user.id;

        }



        // ==========================
        // Prefix command: !ign
        // ==========================

        else {

            ign = args[0];

            discordId = input.author.id;

        }



        if (!ign) {

            if (isSlash) {

                return input.reply({
                    content: "❌ Please provide your Minecraft IGN.",
                    ephemeral: true
                });

            } else {

                return input.reply(
                    "❌ Please provide your Minecraft IGN."
                );

            }

        }



        let players = [];


        if (fs.existsSync(playersFile)) {

            players = JSON.parse(
                fs.readFileSync(playersFile)
            );

        }



        const existingPlayer = players.find(
            player =>
                player.discordId === discordId
        );



        if (existingPlayer) {

            existingPlayer.ign = ign;

        } else {

            players.push({

                discordId: discordId,
                ign: ign

            });

        }



        fs.writeFileSync(
            playersFile,
            JSON.stringify(players, null, 4)
        );



        // ==========================
        // Replies
        // ==========================

        if (isSlash) {

            await input.reply({

                content:
                    `✅ Your IGN has been updated to **${ign}**.`,

                ephemeral: true

            });

        } else {

            await input.reply(
                `✅ Your IGN has been updated to **${ign}**.`
            );

        }


    }

};