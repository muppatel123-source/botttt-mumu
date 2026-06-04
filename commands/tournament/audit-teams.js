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
        return reply({
            content: '📭 No teams found to audit.'
        });
    }

    const issues = [];
    const teamColumns = [[], [], []];
    let teamIndex = 0;

    for (const team of teams) {
        const roster = players.filter(
            player => String(player.teamId) === String(team._id)
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

        if (!team.captainID) {
            teamIssues.push('No captain');
        }

        if (team.captainID && !captainLinked) {
            teamIssues.push('Captain not in roster');
        }

        if (!team.logoURL) {
            teamIssues.push('No logo');
        }

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
                    `Roster mismatch in ${tournament.tournamentKey} (${tournamentPlayers}/${roster.length})`
                );
            }
        }

        teamColumns[teamIndex % 3].push(
            `• ${team.name} (${roster.length})`
        );

        teamIndex++;

        if (teamIssues.length) {
            issues.push({
                team: team.name,
                issues: teamIssues
            });
        }
    }

    const playersWithoutTeam = players.filter(
        player => !player.teamId
    );

    const noGroupTeams = [];
    const noLogoTeams = [];
    const noCaptainTeams = [];
    const captainMismatchTeams = [];
    const rosterMismatchTeams = [];
    const brokenEntries = [];

    for (const issue of issues) {
        for (const text of issue.issues) {
            if (text.startsWith('No group in')) {
                noGroupTeams.push(issue.team);
            }
            else if (text === 'No logo') {
                noLogoTeams.push(issue.team);
            }
            else if (text === 'No captain') {
                noCaptainTeams.push(issue.team);
            }
            else if (text === 'Captain not in roster') {
                captainMismatchTeams.push(issue.team);
            }
            else if (text.startsWith('Roster mismatch')) {
                rosterMismatchTeams.push(
                    `${issue.team}`
                );
            }
            else if (text === 'Broken tournament entry') {
                brokenEntries.push(issue.team);
            }
        }
    }

    const issueLines = [];

    if (noGroupTeams.length) {
        issueLines.push(
            `📋 Missing Groups (${noGroupTeams.length})\n${noGroupTeams.join(', ')}`
        );
    }

    if (noLogoTeams.length) {
        issueLines.push(
            `🖼️ Missing Logos (${noLogoTeams.length})\n${noLogoTeams.join(', ')}`
        );
    }

    if (noCaptainTeams.length) {
        issueLines.push(
            `👑 Missing Captains (${noCaptainTeams.length})\n${noCaptainTeams.join(', ')}`
        );
    }

    if (captainMismatchTeams.length) {
        issueLines.push(
            `⚠️ Captain Not In Roster (${captainMismatchTeams.length})\n${captainMismatchTeams.join(', ')}`
        );
    }

    if (rosterMismatchTeams.length) {
        issueLines.push(
            `🔄 Roster Mismatches (${rosterMismatchTeams.length})\n${rosterMismatchTeams.join(', ')}`
        );
    }

    if (brokenEntries.length) {
        issueLines.push(
            `💥 Broken Tournament Entries (${brokenEntries.length})\n${brokenEntries.join(', ')}`
        );
    }

    if (playersWithoutTeam.length) {
        issueLines.push(
            `🆓 Free Agents (${playersWithoutTeam.length})\n` +
            playersWithoutTeam
                .map(player => player.name)
                .slice(0, 10)
                .join(', ')
        );
    }

    const latestTournament = tournaments[0];

    let registrationText = 'No active tournament found';

    if (latestTournament) {
        const registeredTeams = await TournamentTeam.countDocuments({
            guildId: guild.id,
            tournamentId: latestTournament._id,
            isActive: true
        });

        const targetTeams =
            latestTournament.teamCount ||
            latestTournament.maxTeams ||
            latestTournament.desiredTeams ||
            '?';

        const remaining =
            Number.isFinite(Number(targetTeams))
                ? Math.max(
                    0,
                    Number(targetTeams) - registeredTeams
                )
                : '?';

        registrationText =
            `🏆 ${latestTournament.name}\n` +
            `👥 Registered: **${registeredTeams}/${targetTeams}**\n` +
            `⏳ Remaining: **${remaining}**`;
    }

    const embed = new EmbedBuilder()
        .setColor(
            issueLines.length
                ? 0xF39C12
                : 0x2ECC71
        )
        .setTitle('🧾 TEAM AUDIT REPORT')
        .addFields(
            {
                name: '📊 Registration Progress',
                value: registrationText,
                inline: false
            },
            {
                name: `👥 Teams (${teams.length})`,
                value: teamColumns[0].join('\n') || '—',
                inline: true
            },
            {
                name: '\u200b',
                value: teamColumns[1].join('\n') || '—',
                inline: true
            },
            {
                name: '\u200b',
                value: teamColumns[2].join('\n') || '—',
                inline: true
            },
            {
                name: '⚠️ Issues',
                value:
                    issueLines.length
                        ? issueLines.join('\n\n')
                        : '✅ No issues found.',
                inline: false
            }
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}
