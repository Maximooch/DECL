require("dotenv").config();

const { REST, Routes } = require("discord.js");
const fs = require("fs");

const commands = [];

const commandFiles = fs.readdirSync("./commands")
    .filter(file => file.endsWith(".js"));


for (const file of commandFiles) {

    const command = require(`./commands/${file}`);

    if (command.data) {

        console.log("Loading slash command:", command.data.name);

        commands.push(command.data.toJSON());

    }

}


const rest = new REST({
    version: "10"
}).setToken(process.env.TOKEN);


rest.put(
    Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
    ),
    {
        body: commands
    }
)
.then(() => {
    console.log("✅ Slash commands registered.");
})
.catch(console.error);