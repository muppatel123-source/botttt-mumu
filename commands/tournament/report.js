/**
 * report.js
 *
 * Interactive match result reporter.
 * Select tournament → select group → select fixture → enter scores via modal.
 * Processes the result: updates fixture, team stats, live standings, top stats,
 * master schedules, and bracket.
 *
 * Usage: .report
 * Slash: /report
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { Fixture, TournamentTeam } = require('../../models/Tournament');
const {
    getDefaultTournament,
    getSelectableTournaments,
    getTournamentByKey
} = require('../../utils/getTournament');
const { updateAllLiveStandings } = require('../../utils/updateStandings');
const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');
const { prettyPhase } = require('../../utils/displayHelpers');
const { refreshLiveMasterSchedules } = require('./master-schedule');
const { refreshLiveBracket } = require('./sendbracket');

/** Max fixtures shown in the menu */
const FIXTURE_LIMIT = 15;
const GROUP_FIXTURE_LIMIT = 25;

module.exports = {
    name: 'report',
    description: 'Interactively report a match result.',
    usage: '.report',
    cooldown: 5,
    hidden: true,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Interactively report a match result'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized to use this command.');
            }

            return await startReportMenu({
                client: message.client,
                guild: message.guild,
                userId: message.author.id,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[report] prefix error:', error);
            return message.reply('❌ Failed to start report menu.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized to use this command.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await startReportMenu({
                client: interaction.client,
                guild: interaction.guild,
                userId: interaction.user.id,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[report] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to start report menu.');
            }

            return interaction.reply({
                content: '❌ Failed to start report menu.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   REPORT MENU — Interactive tournament/group/fixture selector
==================================================== */

/**
 * Build and send the report menu with tournament, group, and fixture selectors.
 * Handles all interactions through a component collector.
 */
async function startReportMenu({ client, guild, userId, reply }) {
    const tournaments = await getSelectableTournaments(guild.id);

    if (!tournaments.length) {
        return reply({ content: '📭 No active tournaments found.' });
    }

    let tournament = await getDefaultTournament(guild.id);
    if (!tournament) tournament = tournaments[0];

    let selectedGroup = 'all';
    let pendingFixtures = await getPendingFixtures(guild.id, tournament._id, selectedGroup);

    // ── Send initial menu ──
    const msg = await reply({
        embeds: [buildMenuEmbed(tournament, pendingFixtures, selectedGroup)],
        components: await buildMenuComponents(tournaments, tournament, pendingFixtures, guild.id, selectedGroup)
    });

    if (!msg?.createMessageComponentCollector) return;

    // ── Collector for all menu interactions ──
    const collector = msg.createMessageComponentCollector({
        time: 10 * 60 * 1000
    });

    collector.on('collect', async (interaction) => {
        try {
            // Only the original user can interact
            if (interaction.user.id !== userId) {
                return interaction.reply({
                    content: 'Not your report menu.',
                    ephemeral: true
                });
            }

            if (!interaction.isStringSelectMenu()) return;

            // ── Tournament changed ──
            if (interaction.customId === 'report_tournament') {
                const selected = await getTournamentByKey(guild.id, interaction.values[0]);

                if (!selected) {
                    return interaction.update({
                        content: '❌ Tournament not found.',
                        embeds: [],
                        components: []
                    });
                }

                tournament = selected;
                selectedGroup = 'all';
                pendingFixtures = await getPendingFixtures(guild.id, tournament._id, selectedGroup);

                return interaction.update({
                    embeds: [buildMenuEmbed(tournament, pendingFixtures, selectedGroup)],
                    components: await buildMenuComponents(tournaments, tournament, pendingFixtures, guild.id, selectedGroup)
                });
            }

            // ── Group filter changed ──
            if (interaction.customId === 'report_group') {
                selectedGroup = interaction.values[0];
                pendingFixtures = await getPendingFixtures(guild.id, tournament._id, selectedGroup);

                return interaction.update({
                    embeds: [buildMenuEmbed(tournament, pendingFixtures, selectedGroup)],
                    components: await buildMenuComponents(tournaments, tournament, pendingFixtures, guild.id, selectedGroup)
                });
            }

            // ── Fixture selected → open score modal ──
            if (interaction.customId === 'report_fixture') {
                await handleFixtureSelection({
                    interaction,
                    client,
                    guild,
                    tournament,
                    fixtureId: interaction.values[0],
                    userId,
                    msg,
                    onFixtureUpdated: (updated) => {
                        pendingFixtures = updated;
                    },
                    selectedGroup,
                    tournaments
                });
            }
        } catch (error) {
            console.error('[report] collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Failed to process report action.',
                    ephemeral: true
                }).catch(() => null);
            }
        }
    });

    collector.on('end', async () => {
        await msg.edit({ components: [] }).catch(() => null);
    });
}

/* ====================================================
   FIXTURE SELECTION → MODAL → PROCESS
==================================================== */

/**
 * Show the score input modal, wait for submission, and process the result.
 */
async function handleFixtureSelection({ interaction, client, guild, tournament, fixtureId, userId, msg, onFixtureUpdated, selectedGroup, tournaments }) {
    const fixture = await Fixture.findOne({
        guildId: guild.id,
        tournamentId: tournament._id,
        _id: fixtureId,
        status: { $in: ['Pending', 'Live'] }
    });

    if (!fixture) {
        return interaction.reply({
            content: '❌ This fixture is no longer pending/live.',
            ephemeral: true
        });
    }

    // ── Build modal ──
    const modalId = `report_score_${fixture._id}_${Date.now()}`;

    const homeInput = new TextInputBuilder()
        .setCustomId('home_score')
        .setLabel(`${truncate(fixture.homeTeam, 35)} goals`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Example: 3');

    const awayInput = new TextInputBuilder()
        .setCustomId('away_score')
        .setLabel(`${truncate(fixture.awayTeam, 35)} goals`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Example: 1');

    const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Report #${fixture.matchNumber}`)
        .addComponents(
            new ActionRowBuilder().addComponents(homeInput),
            new ActionRowBuilder().addComponents(awayInput)
        );

    await interaction.showModal(modal);

    // ── Wait for modal submission ──
    const submitted = await interaction.awaitModalSubmit({
        time: 5 * 60 * 1000,
        filter: (modalInteraction) =>
            modalInteraction.customId === modalId &&
            modalInteraction.user.id === userId
    }).catch(() => null);

    if (!submitted) return;

    // ── Validate scores ──
    const homeScore = parseScore(submitted.fields.getTextInputValue('home_score'));
    const awayScore = parseScore(submitted.fields.getTextInputValue('away_score'));

    if (homeScore === null || awayScore === null) {
        return submitted.reply({
            content: '❌ Scores must be valid non-negative numbers.',
            ephemeral: true
        });
    }

    // ── Defer immediately before heavy processing ──
    await submitted.deferReply({ ephemeral: true });

    try {
        const result = await processFixtureReport({
            client,
            guild,
            tournament,
            fixtureId,
            homeScore,
            awayScore
        });

        // ── Confirm to user ──
        await submitted.editReply({ embeds: [result.embed] });

        // ── Refresh the report menu ──
        const updatedFixtures = await getPendingFixtures(guild.id, tournament._id, selectedGroup);

        await msg.edit({
            embeds: [buildMenuEmbed(tournament, updatedFixtures, selectedGroup)],
            components: await buildMenuComponents(tournaments, tournament, updatedFixtures, guild.id, selectedGroup)
        }).catch(() => null);
    } catch (error) {
        console.error('[report] processing error:', error);

        await submitted.editReply({
            content: `❌ Failed to process report: ${error.message || 'Unknown error'}`,
            ephemeral: true
        }).catch(() => null);
    }
}

/* ====================================================
   PENDING FIXTURES
==================================================== */

/**
 * Fetch pending/live fixtures for a tournament, optionally filtered by group.
 */
async function getPendingFixtures(guildId, tournamentId, groupKey = null) {
    const query = {
        guildId,
        tournamentId,
        status: { $in: ['Pending', 'Live'] }
    };

    if (groupKey && groupKey !== 'all') {
        query.groupKey = groupKey;
    }

    return Fixture.find(query)
        .sort({ scheduledAt: 1, matchNumber: 1, createdAt: 1 })
        .limit(groupKey ? GROUP_FIXTURE_LIMIT : FIXTURE_LIMIT)
        .lean();
}

/* ====================================================
   MENU UI BUILDERS
==================================================== */

/**
 * Build the report menu embed showing the tournament info and fixture list.
 */
function buildMenuEmbed(tournament, fixtures, selectedGroup = 'all') {
    const fixtureList = fixtures.length
        ? fixtures.map(f =>
            `#${f.matchNumber} — **${f.homeTeam} vs ${f.awayTeam}** (${f.roundLabel || prettyPhase(f.phase)})`
        ).join('\n')
        : 'No pending/live fixtures found.';

    return new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('📝 REPORT MATCH')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n` +
            `Group Filter: **${selectedGroup === 'all' ? 'All Groups' : selectedGroup}**\n\n` +
            fixtureList
        )
        .setFooter({ text: `Showing ${fixtures.length} fixtures` })
        .setTimestamp();
}

/**
 * Build the report menu components: tournament selector, group filter, fixture selector.
 * Runs a DB query for available groups.
 */
async function buildMenuComponents(tournaments, selectedTournament, fixtures, guildId, selectedGroup = 'all') {
    const rows = [];

    // ── Tournament selector ──
    rows.push(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('report_tournament')
                .setPlaceholder('Select tournament')
                .addOptions(
                    tournaments.slice(0, 25).map(t => ({
                        label: truncate(t.name || t.tournamentKey, 80),
                        description: `Key: ${t.tournamentKey}`,
                        value: t.tournamentKey,
                        default: t.tournamentKey === selectedTournament.tournamentKey
                    }))
                )
        )
    );

    // ── Group filter (only if groups exist) ──
    const groups = (
        await Fixture.distinct('groupKey', {
            guildId,
            tournamentId: selectedTournament._id,
            groupKey: { $exists: true, $ne: null }
        })
    ).sort();

    if (groups.length) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('report_group')
                    .setPlaceholder('Select group')
                    .addOptions([
                        {
                            label: 'All Groups',
                            value: 'all',
                            default: selectedGroup === 'all'
                        },
                        ...groups.map(group => ({
                            label: group,
                            value: group,
                            default: group === selectedGroup
                        }))
                    ])
            )
        );
    }

    // ── Fixture selector ──
    if (fixtures.length) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('report_fixture')
                    .setPlaceholder('Select pending fixture')
                    .addOptions(
                        fixtures.slice(0, 25).map(fixture => ({
                            label: truncate(`#${fixture.matchNumber} ${fixture.homeTeam} vs ${fixture.awayTeam}`, 100),
                            description: truncate(fixture.roundLabel || prettyPhase(fixture.phase) || 'Pending fixture', 100),
                            value: String(fixture._id)
                        }))
                    )
            )
        );
    }

    return rows;
}

/* ====================================================
   RESULT PROCESSING
==================================================== */

/**
 * Process a reported fixture result:
 * 1. Save fixture result
 * 2. Update TournamentTeam stats (if league/group stage)
 * 3. Refresh live standings, top stats, schedules, bracket
 * 4. Emit socket update
 */
async function processFixtureReport({ client, guild, tournament, fixtureId, homeScore, awayScore }) {
    const fixture = await Fixture.findOne({
        guildId: guild.id,
        tournamentId: tournament._id,
        _id: fixtureId,
        status: { $in: ['Pending', 'Live'] }
    });

    if (!fixture) {
        throw new Error('Fixture not found or already played.');
    }

    const affectsStandings = ['league', 'group'].includes(fixture.phase);

    // ── Determine winner ──
    const winner =
        homeScore > awayScore ? fixture.homeTeam
            : awayScore > homeScore ? fixture.awayTeam
                : '';

    // ── Save fixture result ──
    fixture.status = 'Played';
    fixture.result = {
        home: homeScore,
        away: awayScore,
        extraTimeHome: null,
        extraTimeAway: null,
        penaltiesHome: null,
        penaltiesAway: null,
        winner
    };
    fixture.reportedAt = new Date();

    await fixture.save();

    // ── Update team stats ──
    if (affectsStandings) {
        await applyTournamentTeamResult({ fixture, tournament, homeScore, awayScore });
    }

    // ── Refresh live views ──
    await updateAllLiveStandings(client, guild.id).catch(console.error);
    await updateLiveTopStats(client, guild.id).catch(console.error);
    await refreshLiveMasterSchedules(client, guild.id, tournament.tournamentKey).catch(console.error);
    await refreshLiveBracket(client, guild.id, tournament.tournamentKey).catch(console.error);

    if (global.io) {
        global.io.emit('update');
    }

    // ── Build result embed ──
    const embed = new EmbedBuilder()
        .setColor(affectsStandings ? 0x2ECC71 : 0xFEBE10)
        .setTitle(affectsStandings ? '🏟️ MATCH REPORTED' : '🏆 RESULT SAVED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `**${fixture.homeTeam} ${homeScore} - ${awayScore} ${fixture.awayTeam}**\n\n` +
            `🆔 Match: **#${fixture.matchNumber}**\n` +
            `🏷️ Round: **${fixture.roundLabel || prettyPhase(fixture.phase)}**\n` +
            `${fixture.groupKey ? `📦 Group: **${fixture.groupKey}**\n` : ''}` +
            `${winner ? `🥇 Winner: **${winner}**\n` : ''}` +
            `\n${affectsStandings ? '✅ Standings updated.' : 'ℹ️ Knockout result saved.'}`
        )
        .setTimestamp();

    return { fixture, embed };
}

/**
 * Apply the result to both teams' TournamentTeam stats.
 * Increments played, wins, draws, losses, GF, GA, and points.
 */
async function applyTournamentTeamResult({ fixture, tournament, homeScore, awayScore }) {
    const homeEntry = await findTournamentTeamEntry({ fixture, tournament, side: 'home' });
    const awayEntry = await findTournamentTeamEntry({ fixture, tournament, side: 'away' });

    if (!homeEntry || !awayEntry) {
        throw new Error('Tournament team entries missing for fixture.');
    }

    const homeInc = buildTeamStatIncrement({ goalsFor: homeScore, goalsAgainst: awayScore, tournament });
    const awayInc = buildTeamStatIncrement({ goalsFor: awayScore, goalsAgainst: homeScore, tournament });

    await TournamentTeam.updateOne({ _id: homeEntry._id }, { $inc: flattenTeamStatsIncrement(homeInc) });
    await TournamentTeam.updateOne({ _id: awayEntry._id }, { $inc: flattenTeamStatsIncrement(awayInc) });
}

/**
 * Find a TournamentTeam entry for a fixture side.
 * Tries tournamentTeamId → teamId → teamNameSnapshot (in order).
 */
async function findTournamentTeamEntry({ fixture, tournament, side }) {
    const tournamentTeamId = side === 'home' ? fixture.homeTournamentTeamId : fixture.awayTournamentTeamId;
    const teamId = side === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
    const teamName = side === 'home' ? fixture.homeTeam : fixture.awayTeam;

    if (tournamentTeamId) {
        const byTTId = await TournamentTeam.findOne({
            _id: tournamentTeamId,
            guildId: fixture.guildId,
            tournamentId: tournament._id
        });
        if (byTTId) return byTTId;
    }

    if (teamId) {
        const byTeamId = await TournamentTeam.findOne({
            guildId: fixture.guildId,
            tournamentId: tournament._id,
            teamId
        });
        if (byTeamId) return byTeamId;
    }

    return TournamentTeam.findOne({
        guildId: fixture.guildId,
        tournamentId: tournament._id,
        teamNameSnapshot: teamName
    });
}

/**
 * Build stat increment object for a team result.
 * Points come from tournament config (pointsWin, pointsDraw, pointsLoss).
 */
function buildTeamStatIncrement({ goalsFor, goalsAgainst, tournament }) {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let points = 0;

    if (goalsFor > goalsAgainst) {
        wins = 1;
        points = tournament.pointsWin ?? 3;
    } else if (goalsFor < goalsAgainst) {
        losses = 1;
        points = tournament.pointsLoss ?? 0;
    } else {
        draws = 1;
        points = tournament.pointsDraw ?? 1;
    }

    return { played: 1, wins, draws, losses, gf: goalsFor, ga: goalsAgainst, points };
}

/**
 * Flatten a stat increment object into MongoDB dot-notation for $inc.
 */
function flattenTeamStatsIncrement(stats) {
    return {
        'stats.played': stats.played,
        'stats.wins': stats.wins,
        'stats.draws': stats.draws,
        'stats.losses': stats.losses,
        'stats.gf': stats.gf,
        'stats.ga': stats.ga,
        'stats.points': stats.points
    };
}

/* ====================================================
   UTILITY HELPERS
==================================================== */

/**
 * Parse a score input string. Returns null for invalid values.
 */
function parseScore(value) {
    const clean = String(value || '').trim();

    if (!/^\d+$/.test(clean)) return null;

    const number = Number(clean);
    if (!Number.isInteger(number) || number < 0) return null;

    return number;
}

/**
 * Truncate text to max characters with ellipsis.
 */
function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
}
