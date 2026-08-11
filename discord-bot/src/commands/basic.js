const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { privateReply, publicReply } = require("./helpers");

function createBasicCommands({ store }) {
    return [
        {
            data: new SlashCommandBuilder().setName("ping").setDescription("Check whether the bot is online"),
            async execute(interaction) {
                await interaction.reply(privateReply("Pong!"));
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("ign")
                .setDescription("Set your Minecraft in-game name")
                .addStringOption(option => option.setName("name").setDescription("Minecraft username").setRequired(true)),
            async execute(interaction) {
                const ign = store.setIgn(interaction.user.id, interaction.options.getString("name", true));
                await interaction.reply(privateReply(`Your IGN is now **${ign}**.`));
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("roster")
                .setDescription("Show a team roster")
                .addStringOption(option => option.setName("team").setDescription("Team name; omit for your own team")),
            async execute(interaction) {
                const requested = interaction.options.getString("team");
                const team = requested ? store.getTeam(requested) : store.getTeamForUser(interaction.user.id);
                if (!team) return interaction.reply(privateReply("Team not found."));
                const roster = team.members.map(member => {
                    const icon = member.role === "leader" ? "👑" : member.role === "substitute" ? "▪" : "▫";
                    return `${icon} ${member.displayName}`;
                }).join("\n") || "No members yet.";
                const embed = new EmbedBuilder()
                    .setTitle(team.name)
                    .setDescription(`**Members**\n${roster}\n\n**League stats**\nPoints: ${team.points}\nRecord: ${team.wins}W – ${team.losses}L`);
                await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
            }
        },
        {
            data: new SlashCommandBuilder().setName("teams").setDescription("List league teams"),
            async execute(interaction) {
                const teams = store.listTeams();
                if (teams.length === 0) return interaction.reply(publicReply("There are no registered teams."));
                const lines = teams.map((team, index) => `${index + 1}. **${team.name}** — ${team.members.length}/6 members`);
                await interaction.reply(publicReply(lines.join("\n")));
            }
        },
        {
            data: new SlashCommandBuilder().setName("help").setDescription("Show DECL bot commands"),
            async execute(interaction) {
                const embed = new EmbedBuilder()
                    .setTitle("DECL Tournament Bot")
                    .setDescription([
                        "`/ign` Set your Minecraft name",
                        "`/roster` View a roster",
                        "`/teams` List teams",
                        "`/team` Manage a team",
                        "`/draft` Join or administer a draft",
                        "`/match` Create or score matches (management)",
                        "`/results` View weekly results",
                        "`/week` Select the active week (management)"
                    ].join("\n"));
                await interaction.reply({ ...privateReply(), embeds: [embed] });
            }
        }
    ];
}

module.exports = { createBasicCommands };
