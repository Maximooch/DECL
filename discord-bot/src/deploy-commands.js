require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { loadConfig } = require("./config");
const { createCommands } = require("./commands");

async function deploy() {
    const config = loadConfig();
    const commands = createCommands({ store: null, config }).map(command => command.data.toJSON());

    const rest = new REST({ version: "10" }).setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`Registered ${commands.length} guild slash commands.`);
}

deploy().catch(error => {
    console.error("Slash command registration failed:", error.message);
    process.exit(1);
});
