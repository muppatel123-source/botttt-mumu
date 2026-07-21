/**
 * audit-teams.js
 *
 * Audit all teams in the server: roster counts, missing captains/logos,
 * group assignments, roster mismatches, and free agents.
 * Bulk-loads data upfront to avoid N+1 queries.
 *
 * Usage: .audit-teams
 * Slash: /audit-teams
 *
 * Aliases: auditteams, teamaudit
 */

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

    /* ================================================
       PREFIX
    ================================================ */

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
            console.error('[audit-teams] prefix error:', error);
            return message.reply('❌ Failed to audit teams.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runAudit({
                guild: interaction.guild,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[audit-teams] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ Failed to audit teams.' });
            }

            return interaction.reply({ content: '❌ Failed to audit teams.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Run a full audit of teams, players, and tournament participation.
 * Bulk-loads all data upfront to avoid N+1 queries in loops.
 */
async function runAudit({ guild, reply }) {
    // ── Bulk load everything upfront ──
    const [teams, players, tournaments] = await Promise.all([
        Team.find({ guildId: guild.id }).sort({ name: 1 }),
        Player.find({ guildId: guild.id }),
        TournamentSettings.find({ guildId: guild.id }).sort({ createdAt: -1 })
    ]);

    if (!teams.length) {
        return reply({ content: '📭 No teams found to audit.' });
    }

    const teamIds = teams.map(t => t._id);
    const tournamentIds = tournaments.map(t => t._id);

    const [tournamentTeams, tournamentPlayers] = await Promise.all([
        TournamentTeam.find({
            guildId: guild.id,
            isActive: true
        }).populate('teamId tournamentId').lean(),
        TournamentPlayer.find({
            guildId: guild.id,
            isActive: true
        }).lean()
    ]);

    // ── Build lookup maps ──
    const playersByTeam = new Map();
    for (const player of players) {
        const tid = String(player.teamId);
        if (!playersByTeam.has(tid)) playersByTeam.set(tid, []);
        playersByTeam.get(tid).push(player);
    }

    const tournamentTeamsByTeam = new Map();
    for (const tt of tournamentTeams) {
        const tid = String(tt.teamId?._id || tt.teamId);
        if (!tournamentTeamsByTeam.has(tid)) tournamentTeamsByTeam.set(tid, []);
        tournamentTeamsByTeam.get(tid).push(tt);
    }

    const tournamentPlayersByTeamTournament = new Map();
    for (const tp of tournamentPlayers) {
        const key = `${String(tp.teamId)}_${String(tp.tournamentId)}`;
        if (!tournamentPlayersByTeamTournament.has(key)) tournamentPlayersByTeamTournament.set(key, 0);
        tournamentPlayersByTeamTournament.set(key, tournamentPlayersByTeamTournament.get(key) + 1);
    }

    // ── Audit each team ──
    const teamColumns = [[], [], []];
    const issues = {
        missingGroups: [],
        missingLogos: [],
        missingCaptains: [],
        captainMismatch: [],
        rosterMismatch: [],
        brokenEntries: []
    };

    teams.forEach((team, index) => {
        const teamId = String(team._id);
        const roster = playersByTeam.get(teamId) || [];
        const rosterCount = roster.length;

        teamColumns[index % 3].push(`• ${team.name} (${rosterCount})`);

        // ── Captain checks ──
        if (!team.captainID) {
            issues.missingCaptains.push(team.name);
        } else {
            const captainInRoster = roster.some(p => p.discordID === team.captainID);
            if (!captainInRoster) {
                issues.captainMismatch.push(team.name);
            }
        }

        // ── Logo check ──
        if (!team.logoURL) {
            issues.missingLogos.push(team.name);
        }

        // ── Tournament participation checks ──
        const ttEntries = tournamentTeamsByTeam.get(teamId) || [];

        for (const tt of ttEntries) {
            const tournament = tt.tournamentId;
            const tid = String(tournament?._id);

            if (!tournament) {
                if (!issues.brokenEntries.includes(team.name)) {
                    issues.brokenEntries.push(team.name);
                }
                continue;
            }

            // Group check
            if ((tournament.groupCount || 0) > 0 && !String(tt.groupKey || '').trim()) {
                issues.missingGroups.push(`${team.name} (${tournament.tournamentKey})`);
            }

            // Roster mismatch check
            const tpCount = tournamentPlayersByTeamTournament.get(`${teamId}_${tid}`) || 0;
            if (tpCount !== rosterCount) {
                issues.rosterMismatch.push(`${team.name} in ${tournament.tournamentKey} (${tpCount}/${rosterCount})`);
            }
        }
    });

    // ── Free agents ──
    const freeAgents = players.filter(p => !p.teamId);

    // ── Build issue lines ──
    const issueLines = [];

    if (issues.missingGroups.length) {
        issueLines.push(`📋 Missing Groups (${issues.missingGroups.length})\n${issues.missingGroups.join(', ')}`);
    }
    if (issues.missingLogos.length) {
        issueLines.push(`🖼️ Missing Logos (${issues.missingLogos.length})\n${issues.missingLogos.join(', ')}`);
    }
    if (issues.missingCaptains.length) {
        issueLines.push(`👑 Missing Captains (${issues.missingCaptains.length})\n${issues.missingCaptains.join(', ')}`);
    }
    if (issues.captainMismatch.length) {
        issueLines.push(`⚠️ Captain Not In Roster (${issues.captainMismatch.length})\n${issues.captainMismatch.join(', ')}`);
    }
    if (issues.rosterMismatch.length) {
        issueLines.push(`🔄 Roster Mismatches (${issues.rosterMismatch.length})\n${issues.rosterMismatch.join(', ')}`);
    }
    if (issues.brokenEntries.length) {
        issueLines.push(`💥 Broken Tournament Entries (${issues.brokenEntries.length})\n${issues.brokenEntries.join(', ')}`);
    }
    if (freeAgents.length) {
        issueLines.push(
            `🆓 Free Agents (${freeAgents.length})\n` +
            freeAgents.map(p => p.name).slice(0, 10).join(', ')
        );
    }

    // ── Latest tournament registration progress ──
    const latestTournament = tournaments[0];
    let registrationText = 'No active tournament found';

    if (latestTournament) {
        const registeredTeams = tournamentTeams.filter(
            tt => String(tt.tournamentId?._id || tt.tournamentId) === String(latestTournament._id)
        ).length;

        const targetTeams = latestTournament.teamCount || latestTournament.maxTeams || latestTournament.desiredTeams || '?';
        const remaining = Number.isFinite(Number(targetTeams))
            ? Math.max(0, Number(targetTeams) - registeredTeams)
            : '?';

        registrationText =
            `🏆 ${latestTournament.name}\n` +
            `👥 Registered: **${registeredTeams}/${targetTeams}**\n` +
            `⏳ Remaining: **${remaining}**`;
    }

    // ── Build embed ──
    const embed = new EmbedBuilder()
        .setColor(issueLines.length ? 0xF39C12 : 0x2ECC71)
        .setTitle('🧾 TEAM AUDIT REPORT')
        .addFields(
            { name: '📊 Registration Progress', value: registrationText, inline: false },
            { name: `👥 Teams (${teams.length})`, value: teamColumns[0].join('\n') || '—', inline: true },
            { name: '\u200b', value: teamColumns[1].join('\n') || '—', inline: true },
            { name: '\u200b', value: teamColumns[2].join('\n') || '—', inline: true },
            {
                name: '⚠️ Issues',
                value: issueLines.length ? issueLines.join('\n\n') : '✅ No issues found.',
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
