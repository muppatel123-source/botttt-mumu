const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'audit-teams',
    description: 'Audit global teams and tournament participation.',
    usage: '.audit-teams',
    aliases: ['auditteams', 'teamaudit'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('audit-teams')
        .setDescription('Audit global teams and tournament participation'),

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            return await runAudit({
                guild: message.guild,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('audit-teams prefix error:', error);
            return message.reply('❌ Failed to audit teams.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runAudit({
                guild: interaction.guild,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('audit-teams slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply({ content: '❌ Failed to audit teams.' });
            }

            return interaction.reply({
                content: '❌ Failed to audit teams.',
                ephemeral: true
            });
        }
    }
};

async function runAudit({
    guild,
    reply
}) {
    const [teams, players, tournaments] = await Promise.all([
        Team.find({ guildId: guild.id }).sort({ name: 1 }),
        Player.find({ guildId: guild.id }),
        TournamentSettings.find({ guildId: guild.id }).sort({ createdAt: -1 })
    ]);

    if (!teams.length) {
        return reply({ content: '📭 No teams found to audit.' });
    }

    const issues = [];
    const summary = [];

    for (const team of teams) {
        const roster = players.filter(player =>
            String(player.teamId) === String(team._id)
        );

        const captainLinked = team.captainID
            ? roster.some(player => player.discordID === team.captainID)
            : false;

        const activeTournamentEntries = await TournamentTeam.find({
            guildId: guild.id,
            teamId: team._id,
            isActive: true
        }).populate('tournamentId');

        const teamIssues = [];

        if (!team.captainID) teamIssues.push('No captain');
        if (team.captainID && !captainLinked) teamIssues.push('Captain not in roster');
        if (!team.stadium) teamIssues.push('No stadium');
        if (!team.logoURL) teamIssues.push('No logo');
        if (!team.color) teamIssues.push('No color');

        for (const entry of activeTournamentEntries) {
            const tournament = entry.tournamentId;

            if (!tournament) {
                teamIssues.push('Broken tournament entry');
                continue;
            }

            if ((tournament.groupCount || 0) > 0 && !entry.groupKey) {
                teamIssues.push(`No group in ${tournament.tournamentKey}`);
            }

            const tournamentPlayers = await TournamentPlayer.countDocuments({
                guildId: guild.id,
                tournamentId: tournament._id,
                teamId: team._id,
                isActive: true
            });

            if (tournamentPlayers !== roster.length) {
                teamIssues.push(
                    `Roster sync mismatch in ${tournament.tournamentKey} (${tournamentPlayers}/${roster.length})`
                );
            }
        }

        summary.push(
            `**${team.name}** — ${roster.length} player(s), ` +
            `${activeTournamentEntries.length} active tournament(s)`
        );

        if (teamIssues.length) {
            issues.push(`**${team.name}:** ${teamIssues.join(', ')}`);
        }
    }

    const playersWithoutTeam = players.filter(player => !player.teamId);

    if (playersWithoutTeam.length) {
        issues.push(
            `**Unassigned Players:** ` +
            `${playersWithoutTeam.map(p => p.name).slice(0, 8).join(', ')}` +
            `${playersWithoutTeam.length > 8 ? ` +${playersWithoutTeam.length - 8} more` : ''}`
        );
    }

    const tournamentsWithoutTeams = [];

    for (const tournament of tournaments) {
        const count = await TournamentTeam.countDocuments({
            guildId: guild.id,
            tournamentId: tournament._id,
            isActive: true
        });

        if (count === 0) {
            tournamentsWithoutTeams.push(tournament.tournamentKey);
        }
    }

    if (tournamentsWithoutTeams.length) {
        issues.push(
            `**Tournaments Without Teams:** ${tournamentsWithoutTeams.join(', ')}`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(issues.length ? 0xF39C12 : 0x2ECC71)
        .setTitle('🧾 TEAM AUDIT REPORT')
        .addFields(
            {
                name: 'Summary',
                value:
                    summary.slice(0, 15).join('\n') +
                    (summary.length > 15 ? `\n…and **${summary.length - 15}** more.` : ''),
                inline: false
            },
            {
                name: 'Issues Found',
                value:
                    issues.length
                        ? issues.slice(0, 15).join('\n') +
                          (issues.length > 15 ? `\n…and **${issues.length - 15}** more.` : '')
                        : '✅ No structural issues detected.',
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}