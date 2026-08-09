const { SlashCommandBuilder } = require("discord.js");
const { privateReply, publicReply, requireManagement } = require("./helpers");

function createTournamentCommands({ store, config }) {
    return [
        {
            data: new SlashCommandBuilder()
                .setName("match")
                .setDescription("Create and score tournament matches (management)")
                .addSubcommand(sub => sub.setName("create").setDescription("Create a match")
                    .addStringOption(option => option.setName("team1").setDescription("First team").setRequired(true))
                    .addStringOption(option => option.setName("team2").setDescription("Second team").setRequired(true)))
                .addSubcommand(sub => sub.setName("score").setDescription("Record a score")
                    .addStringOption(option => option.setName("team1").setDescription("First team").setRequired(true))
                    .addStringOption(option => option.setName("team2").setDescription("Second team").setRequired(true))
                    .addIntegerOption(option => option.setName("score1").setDescription("First team's score").setMinValue(0).setRequired(true))
                    .addIntegerOption(option => option.setName("score2").setDescription("Second team's score").setMinValue(0).setRequired(true))),
            async execute(interaction) {
                requireManagement(interaction, config);
                const action = interaction.options.getSubcommand();
                const team1 = interaction.options.getString("team1", true);
                const team2 = interaction.options.getString("team2", true);
                if (action === "create") {
                    const match = store.createMatch(team1, team2);
                    return interaction.reply(publicReply(`Created Week ${match.week}: **${match.team1}** vs **${match.team2}**.`));
                }
                const match = store.scoreMatch(
                    team1,
                    team2,
                    interaction.options.getInteger("score1", true),
                    interaction.options.getInteger("score2", true)
                );
                return interaction.reply(publicReply(`Updated Week ${match.week}: **${match.team1} ${match.score1}–${match.score2} ${match.team2}**.`));
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("results")
                .setDescription("Show tournament results")
                .addIntegerOption(option => option.setName("week").setDescription("Week number; defaults to active week").setMinValue(1)),
            async execute(interaction) {
                const week = interaction.options.getInteger("week") || store.getActiveWeek();
                const matches = store.listMatches(week);
                if (!matches.length) return interaction.reply(privateReply(`No matches are scheduled for Week ${week}.`));
                const lines = matches.map(match => {
                    const score = match.score1 === null ? "TBD" : `${match.score1}–${match.score2}`;
                    return `${match.team1} | **${score}** | ${match.team2}`;
                });
                return interaction.reply(publicReply(`🏆 **Week ${week} Results**\n${lines.join("\n")}`));
            }
        },
        {
            data: new SlashCommandBuilder()
                .setName("week")
                .setDescription("Set the active tournament week (management)")
                .addIntegerOption(option => option.setName("number").setDescription("Week number").setMinValue(1).setRequired(true)),
            async execute(interaction) {
                requireManagement(interaction, config);
                const week = store.setActiveWeek(interaction.options.getInteger("number", true));
                return interaction.reply(publicReply(`Week ${week} is now active.`));
            }
        }
    ];
}

module.exports = { createTournamentCommands };
