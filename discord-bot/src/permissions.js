function hasRole(interaction, roleId) {
    return Boolean(interaction.member?.roles?.cache?.has(roleId));
}

function isManagement(interaction, config) {
    return hasRole(interaction, config.managementRoleId);
}

function isTeamLeader(interaction, config) {
    return isManagement(interaction, config) || hasRole(interaction, config.teamLeaderRoleId);
}

module.exports = { hasRole, isManagement, isTeamLeader };
