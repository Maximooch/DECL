const { SlashCommandBuilder } = require("discord.js");
const { DomainError } = require("../store");
const {
    privateReply,
    publicReply,
    toMember,
    requireManagement,
    requireTeamLeader,
    resolveManagedTeam,
    updateLeaderRoles
} = require("./helpers");

function teamOption(option) {
    return option.setName("team").setDescription("Team name (management only when managing another team)");
}

function createTeamCommand({ store, config }) {
    const data = new SlashCommandBuilder()
        .setName("team")
        .setDescription("Create and manage teams")
        .addSubcommand(sub => sub.setName("create").setDescription("Create a team")
            .addStringOption(option => option.setName("name").setDescription("Team name").setRequired(true)))
        .addSubcommand(sub => sub.setName("add").setDescription("Add a Discord member")
            .addUserOption(option => option.setName("user").setDescription("Member to add").setRequired(true))
            .addStringOption(option => option.setName("role").setDescription("Roster role")
                .addChoices({ name: "Player", value: "player" }, { name: "Substitute", value: "substitute" }))
            .addStringOption(teamOption))
        .addSubcommand(sub => sub.setName("substitute").setDescription("Move a member to the substitute roster")
            .addUserOption(option => option.setName("user").setDescription("Team member").setRequired(true))
            .addStringOption(teamOption))
        .addSubcommand(sub => sub.setName("promote").setDescription("Move a substitute to the main roster")
            .addUserOption(option => option.setName("user").setDescription("Team member").setRequired(true))
            .addStringOption(teamOption))
        .addSubcommand(sub => sub.setName("remove").setDescription("Remove a member")
            .addUserOption(option => option.setName("user").setDescription("Team member").setRequired(true))
            .addStringOption(teamOption))
        .addSubcommand(sub => sub.setName("transfer").setDescription("Transfer your team's leadership")
            .addUserOption(option => option.setName("user").setDescription("New leader").setRequired(true)))
        .addSubcommand(sub => sub.setName("leave").setDescription("Leave your current team"))
        .addSubcommand(sub => sub.setName("rename").setDescription("Rename a team")
            .addStringOption(option => option.setName("name").setDescription("New team name").setRequired(true))
            .addStringOption(teamOption))
        .addSubcommand(sub => sub.setName("setleader").setDescription("Set a team's leader (management)")
            .addStringOption(option => option.setName("team").setDescription("Team name").setRequired(true))
            .addUserOption(option => option.setName("user").setDescription("New leader").setRequired(true)))
        .addSubcommand(sub => sub.setName("disband").setDescription("Disband a team (management)")
            .addStringOption(option => option.setName("team").setDescription("Team name").setRequired(true)));

    return {
        data,
        async execute(interaction) {
            const action = interaction.options.getSubcommand();

            if (action === "create") {
                const team = store.createTeam(interaction.options.getString("name", true), toMember(interaction.user));
                const warnings = await updateLeaderRoles(interaction.guild, config.teamLeaderRoleId, null, interaction.user.id);
                const suffix = warnings.length ? " The team was saved, but I could not assign the Team Leader role." : "";
                return interaction.reply(publicReply(`Created **${team.name}**.${suffix}`));
            }

            if (action === "leave") {
                const result = store.leaveTeam(interaction.user.id);
                const warnings = await updateLeaderRoles(
                    interaction.guild,
                    config.teamLeaderRoleId,
                    result.previousLeaderId,
                    result.newLeaderId
                );
                const suffix = warnings.length ? " A manager may need to synchronize the Team Leader role." : "";
                return interaction.reply(publicReply(`You left **${result.team.name}**${result.deleted ? "; the empty team was deleted" : ""}.${suffix}`));
            }

            if (action === "transfer") {
                requireTeamLeader(interaction, config);
                const current = store.getTeamForUser(interaction.user.id);
                if (!current || current.leaderId !== interaction.user.id) throw new DomainError("You are not a team leader.");
                const user = interaction.options.getUser("user", true);
                const team = store.transferLeadership(current.name, interaction.user.id, toMember(user));
                const warnings = await updateLeaderRoles(interaction.guild, config.teamLeaderRoleId, team.previousLeaderId, user.id);
                const suffix = warnings.length ? " A manager may need to synchronize Discord roles." : "";
                return interaction.reply(publicReply(`Transferred **${team.name}** to ${user.username}.${suffix}`));
            }

            if (action === "setleader") {
                requireManagement(interaction, config);
                const teamName = interaction.options.getString("team", true);
                const user = interaction.options.getUser("user", true);
                const team = store.transferLeadership(teamName, null, toMember(user));
                const warnings = await updateLeaderRoles(interaction.guild, config.teamLeaderRoleId, team.previousLeaderId, user.id);
                const suffix = warnings.length ? " A manager may need to synchronize Discord roles." : "";
                return interaction.reply(publicReply(`Set ${user.username} as leader of **${team.name}**.${suffix}`));
            }

            if (action === "disband") {
                requireManagement(interaction, config);
                const team = store.disbandTeam(interaction.options.getString("team", true));
                const warnings = await updateLeaderRoles(interaction.guild, config.teamLeaderRoleId, team.leaderId, null);
                const suffix = warnings.length ? " I could not remove the former leader's Discord role." : "";
                return interaction.reply(publicReply(`Disbanded **${team.name}**.${suffix}`));
            }

            const requestedTeam = interaction.options.getString("team");
            const team = resolveManagedTeam(interaction, store, config, requestedTeam);

            if (action === "add") {
                const user = interaction.options.getUser("user", true);
                const role = interaction.options.getString("role") || "player";
                const updated = store.addTeamMember(team.name, toMember(user), role);
                return interaction.reply(publicReply(`Added ${user.username} to **${updated.name}** as ${role}.`));
            }

            if (action === "substitute" || action === "promote") {
                const user = interaction.options.getUser("user", true);
                const role = action === "substitute" ? "substitute" : "player";
                const updated = store.setMemberRole(team.name, user.id, role);
                return interaction.reply(publicReply(`Moved ${user.username} to the ${role === "player" ? "main" : "substitute"} roster for **${updated.name}**.`));
            }

            if (action === "remove") {
                const user = interaction.options.getUser("user", true);
                const updated = store.removeTeamMember(team.name, user.id);
                return interaction.reply(publicReply(`Removed ${user.username} from **${updated.name}**.`));
            }

            if (action === "rename") {
                const updated = store.renameTeam(team.name, interaction.options.getString("name", true));
                return interaction.reply(publicReply(`Renamed the team to **${updated.name}**.`));
            }

            return interaction.reply(privateReply("Unknown team action."));
        }
    };
}

module.exports = { createTeamCommand };
