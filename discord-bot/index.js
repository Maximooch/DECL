require("dotenv").config();

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const fs = require("fs");


const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.MessageContent,

        GatewayIntentBits.GuildMembers

    ]

});



client.commands = new Map();



// ===============================
// LOAD COMMANDS
// ===============================

const commandFiles = fs.readdirSync("./commands")
    .filter(file => file.endsWith(".js"));



for (const file of commandFiles) {


    const command =
        require(`./commands/${file}`);



    if (command.name) {

        client.commands.set(
            command.name,
            command
        );

    }



    if (command.data) {

        client.commands.set(
            command.data.name,
            command
        );

    }



    if (command.aliases) {

        command.aliases.forEach(alias => {

            client.commands.set(
                alias,
                command
            );

        });

    }



    console.log(
        `Loaded command: ${file}`
    );

}




client.once("ready", () => {

    console.log(
        `${client.user.tag} is online!`
    );

});





// ===============================
// PREFIX COMMANDS (!)
// ===============================

client.on(
    "messageCreate",
    async message => {


    if (message.author.bot) return;


    if (!message.content.startsWith("!")) {
        return;
    }



    const args =
    message.content
    .slice(1)
    .trim()
    .split(/ +/);



    const commandName =
        args.shift()
        .toLowerCase();



    const command =
        client.commands.get(commandName);



    console.log(
        "Prefix command:",
        commandName
    );


    console.log(
        "Found:",
        command ? command.name : "NO"
    );



    if (!command) return;



    try {


        await command.execute(
            message,
            args
        );


    } catch(error) {


        console.error(error);


        message.reply(
            "❌ There was an error running this command."
        );


    }


});






// ===============================
// SLASH COMMANDS + BUTTONS
// ===============================

client.on(
    "interactionCreate",
    async interaction => {



    // ===========================
    // BUTTONS
    // ===========================

    if (interaction.isButton()) {


        if (interaction.customId === "draft_join") {


            const draftFile =
                "./data/draft.json";


            let draft =
                JSON.parse(
                    fs.readFileSync(draftFile)
                );



            const teams =
                require("./data/teams.json");



            const team =
                teams.find(
                    t =>
                    t.leader === interaction.user.id
                );



            if (!team) {


                return interaction.reply({

                    content:
                    "❌ You are not a team leader.",

                    ephemeral:true

                });

            }



            if (!draft.teams) {

                draft.teams = [];

            }



            if (
                !draft.teams.find(
                    t =>
                    t.name === team.name
                )
            ) {


                draft.teams.push({

                    name:
                    team.name,

                    leader:
                    interaction.user.id

                });


            }



            if (
                !draft.leaders.includes(
                    interaction.user.id
                )
            ) {


                draft.leaders.push(
                    interaction.user.id
                );


            }



            fs.writeFileSync(

                draftFile,

                JSON.stringify(
                    draft,
                    null,
                    4
                )

            );



            return interaction.reply({

                content:
                `✅ ${team.name} joined the draft.`,

                ephemeral:true

            });


        }




        if (interaction.customId === "draft_decline") {


            return interaction.reply({

                content:
                "❌ You declined the draft.",

                ephemeral:true

            });


        }


        return;

    }





    // ===========================
    // SLASH COMMANDS
    // ===========================


    if (!interaction.isChatInputCommand()) {
        return;
    }



    console.log(
        "Slash command used:",
        interaction.commandName
    );



    const command =
        client.commands.get(
            interaction.commandName
        );



    if (!command) {


        console.log(
            "Slash command not found:",
            interaction.commandName
        );


        return;

    }



    try {


        await command.execute(
            interaction
        );


    } catch(error) {


        console.error(error);



        if (
            interaction.replied ||
            interaction.deferred
        ) {


            await interaction.followUp({

                content:
                "❌ There was an error executing this command.",

                ephemeral:true

            });


        } else {


            await interaction.reply({

                content:
                "❌ There was an error executing this command.",

                ephemeral:true

            });


        }


    }


});






client.login(
    process.env.TOKEN
);