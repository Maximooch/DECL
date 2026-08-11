const { MessageFlags } = require("discord.js");
const { DomainError } = require("../store");
const { isManagement, isTeamLeader } = require("../permissions");

function privateReply(content = undefined) {
    return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function publicReply(content) {
    return { content, allowedMentions: { parse: [] } };
}

function toMember(user) {
    return { id: user.id, displayName: user.globalName || user.username };
}

function requireManagement(interaction, config) {
    if (!isManagement(interaction, config)) throw new DomainError("Only league management can use this command.");
}

function requireTeamLeader(interaction, config) {
    if (!isTeamLeader(interaction, config)) throw new DomainError("Only a team leader can use this command.");
}

function requireDraftPoolAccess(interaction, store, config) {
    if (isManagement(interaction, config)) return;
    requireTeamLeader(interaction, config);
    const team = store.getTeamForUser(interaction.user.id);
    if (!team || team.leaderId !== interaction.user.id) {
        throw new DomainError("Only current team leaders and league management can view the locked pool.");
    }
}

function resolveManagedTeam(interaction, store, config, requestedName) {
    if (requestedName) {
        requireManagement(interaction, config);
        const team = store.getTeam(requestedName);
        if (!team) throw new DomainError("Team not found.");
        return team;
    }
    requireTeamLeader(interaction, config);
    const team = store.getTeamForUser(interaction.user.id);
    if (!team || team.leaderId !== interaction.user.id) {
        throw new DomainError("You are not a team leader. Management may specify a team explicitly.");
    }
    return team;
}

async function updateLeaderRoles(guild, roleId, previousLeaderId, newLeaderId) {
    const warnings = [];
    if (previousLeaderId && previousLeaderId !== newLeaderId) {
        const previous = await guild.members.fetch(previousLeaderId).catch(() => {
            warnings.push("find the former team leader");
            return null;
        });
        if (previous) await previous.roles.remove(roleId).catch(() => warnings.push("remove the old Team Leader role"));
    }
    if (newLeaderId) {
        const next = await guild.members.fetch(newLeaderId).catch(() => {
            warnings.push("find the new team leader");
            return null;
        });
        if (next) await next.roles.add(roleId).catch(() => warnings.push("assign the new Team Leader role"));
    }
    return warnings;
}

module.exports = {
    privateReply,
    publicReply,
    toMember,
    requireManagement,
    requireTeamLeader,
    requireDraftPoolAccess,
    resolveManagedTeam,
    updateLeaderRoles
};
