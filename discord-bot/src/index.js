require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require("discord.js");
const { loadConfig } = require("./config");
const { LeagueStore, DomainError } = require("./store");
const { createCommands } = require("./commands");

const config = loadConfig();
const store = new LeagueStore(config.databasePath);
const imported = store.importLegacyData(path.join(__dirname, "..", "data"));
if (imported) console.log("Imported legacy JSON data into SQLite.");

const commands = createCommands({ store, config });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection(commands.map(command => [command.data.name, command]));

let heartbeat;

client.once(Events.ClientReady, readyClient => {
    console.log(`${readyClient.user.tag} is online with ${commands.length} slash commands.`);
    const heartbeatPath = path.join(config.dataDirectory, "healthy");
    const writeHeartbeat = () => fs.writeFileSync(heartbeatPath, new Date().toISOString());
    writeHeartbeat();
    heartbeat = setInterval(writeHeartbeat, 60_000);
    heartbeat.unref();
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        const expected = error instanceof DomainError;
        if (!expected) console.error(`Command ${interaction.commandName} failed:`, error);
        const response = {
            content: expected ? error.message : "An unexpected error occurred. League management has been notified.",
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] }
        };
        if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(console.error);
        else await interaction.reply(response).catch(console.error);
    }
});

async function shutdown(signal) {
    console.log(`Received ${signal}; shutting down.`);
    if (heartbeat) clearInterval(heartbeat);
    client.destroy();
    store.close();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.login(config.token).catch(error => {
    console.error("Discord login failed:", error.message);
    store.close();
    process.exit(1);
});
