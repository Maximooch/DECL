const { SlashCommandBuilder } = require("discord.js");
const { DomainError } = require("../store");
const { isTeamLeader } = require("../permissions");
const { privateReply, publicReply, requireManagement } = require("./helpers");

function createDraftCommand({ store, config }) {
    const data = new SlashCommandBuilder()
        .setName("draft")
        .setDescription("Join or administer the player draft")
        .addSubcommand(sub => sub.setName("join").setDescription("Join the open player pool"))
        .addSubcommand(sub => sub.setName("participate").setDescription("Enter your team after registration is locked"))
        .addSubcommand(sub => sub.setName("pick").setDescription("Pick a player on your team's turn")
            .addStringOption(option => option.setName("player").setDescription("Player IGN").setRequired(true)))
        .addSubcommand(sub => sub.setName("view").setDescription("View available players"))
        .addSubcommand(sub => sub.setName("status").setDescription("View draft status and completed picks"))
        .addSubcommand(sub => sub.setName("open").setDescription("Open player registration (management)"))
        .addSubcommand(sub => sub.setName("lock").setDescription("Lock registration (management)"))
        .addSubcommand(sub => sub.setName("start").setDescription("Start the draft (management)"))
        .addSubcommand(sub => sub.setName("stop").setDescription("Stop and reset the draft (management)"));

    return {
        data,
        async execute(interaction) {
            const action = interaction.options.getSubcommand();

            if (action === "join") {
                const ign = store.getIgn(interaction.user.id) || interaction.user.username;
                store.joinDraft({ id: interaction.user.id, ign });
                return interaction.reply(privateReply(`You joined the draft pool as **${ign}**.`));
            }

            if (action === "participate") {
                if (!isTeamLeader(interaction, config)) throw new DomainError("Only a team leader can enter a team in the draft.");
                const team = store.joinDraftAsTeam(interaction.user.id);
                return interaction.reply(publicReply(`**${team.name}** joined the draft.`));
            }

            if (action === "pick") {
                if (!isTeamLeader(interaction, config)) throw new DomainError("Only a team leader can make a draft pick.");
                const result = store.pickDraftPlayer(interaction.user.id, interaction.options.getString("player", true));
                const next = result.state.phase === "finished"
                    ? " The draft is complete."
                    : ` Next: **${result.state.currentTeam}**.`;
                return interaction.reply(publicReply(`**${result.team.name}** selected **${result.player.ign}**.${next}`));
            }

            if (action === "view") {
                if (!isTeamLeader(interaction, config)) throw new DomainError("Only team leaders and management can view the locked pool.");
                const state = store.getDraftState();
                if (!["locked", "drafting", "finished"].includes(state.phase)) {
                    throw new DomainError("The pool becomes visible after registration is locked.");
                }
                const pool = store.getDraftPool();
                return interaction.reply(privateReply(pool.length ? pool.map(player => `• ${player.ign}`).join("\n") : "The draft pool is empty."));
            }

            if (action === "status") {
                const state = store.getDraftState();
                const picks = store.getDraftPicks();
                const lines = [`Phase: **${state.phase}**`];
                if (state.currentTeam) lines.push(`Current team: **${state.currentTeam}**`);
                if (picks.length) lines.push("", ...picks.map(pick => `${pick.position + 1}. ${pick.team} — ${pick.ign}`));
                return interaction.reply(publicReply(lines.join("\n")));
            }

            requireManagement(interaction, config);
            if (action === "open") store.openDraft();
            if (action === "lock") store.lockDraft();
            if (action === "start") store.startDraft();
            if (action === "stop") store.stopDraft();
            const state = store.getDraftState();
            const next = action === "lock"
                ? " Team leaders can now use `/draft participate`."
                : action === "start" && state.currentTeam
                    ? ` First pick: **${state.currentTeam}**.`
                    : "";
            return interaction.reply(publicReply(`Draft is now **${state.phase}**.${next}`));
        }
    };
}

module.exports = { createDraftCommand };
