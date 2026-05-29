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

const {
    Fixture,
    TournamentTeam
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getSelectableTournaments,
    getTournamentByKey
} = require('../../utils/getTournament');

const { updateAllLiveStandings } = require('../../utils/updateStandings');
const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');
const { refreshLiveMasterSchedules } = require('./master-schedule');
const { refreshLiveBracket } = require('./sendbracket');

const FIXTURE_LIMIT = 15;

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
            console.error('report prefix error:', error);
            return message.reply('❌ Failed to start report menu.');
        }
    },

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
            console.error('report slash error:', error);

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

async function startReportMenu({
    client,
    guild,
    userId,
    reply
}) {
    const tournaments = await getSelectableTournaments(guild.id);

    if (!tournaments.length) {
        return reply({
            content: '📭 No active tournaments found.'
        });
    }

    let tournament = await getDefaultTournament(guild.id);
    if (!tournament) tournament = tournaments[0];

    let pendingFixtures = await getPendingFixtures(guild.id, tournament._id);

    const msg = await reply({
        embeds: [buildMenuEmbed(tournament, pendingFixtures)],
        components: buildMenuComponents(tournaments, tournament, pendingFixtures)
    });

    if (!msg?.createMessageComponentCollector) return;

    const collector = msg.createMessageComponentCollector({
        time: 10 * 60 * 1000
    });

    collector.on('collect', async interaction => {
        try {
            if (interaction.user.id !== userId) {
                return interaction.reply({
                    content: 'Not your report menu.',
                    ephemeral: true
                });
            }

            if (!interaction.isStringSelectMenu()) return;

            if (interaction.customId === 'report_tournament') {
                const selectedTournament = await getTournamentByKey(
                    guild.id,
                    interaction.values[0]
                );

                if (!selectedTournament) {
                    return interaction.update({
                        content: '❌ Tournament not found.',
                        embeds: [],
                        components: []
                    });
                }

                tournament = selectedTournament;
                pendingFixtures = await getPendingFixtures(guild.id, tournament._id);

                return interaction.update({
                    embeds: [buildMenuEmbed(tournament, pendingFixtures)],
                    components: buildMenuComponents(tournaments, tournament, pendingFixtures)
                });
            }

            if (interaction.customId === 'report_fixture') {
                const fixtureId = interaction.values[0];

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

                const modalId = `report_score_${fixture._id}_${Date.now()}`;

                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(`Report #${fixture.matchNumber}`);

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

                modal.addComponents(
                    new ActionRowBuilder().addComponents(homeInput),
                    new ActionRowBuilder().addComponents(awayInput)
                );

                await interaction.showModal(modal);

                const submitted = await interaction.awaitModalSubmit({
                    time: 5 * 60 * 1000,
                    filter: modalInteraction =>
                        modalInteraction.customId === modalId &&
                        modalInteraction.user.id === userId
                }).catch(() => null);

                if (!submitted) return;

                const homeScore = parseScore(
                    submitted.fields.getTextInputValue('home_score')
                );

                const awayScore = parseScore(
                    submitted.fields.getTextInputValue('away_score')
                );

                if (homeScore === null || awayScore === null) {
                    return submitted.reply({
                        content: '❌ Scores must be valid non-negative numbers.',
                        ephemeral: true
                    });
                }

                const result = await processFixtureReport({
                    client,
                    guild,
                    tournament,
                    fixtureId,
                    homeScore,
                    awayScore
                });

                await submitted.reply({
                    embeds: [result.embed],
                    ephemeral: true
                });

                pendingFixtures = await getPendingFixtures(guild.id, tournament._id);

                await msg.edit({
                    embeds: [buildMenuEmbed(tournament, pendingFixtures)],
                    components: buildMenuComponents(tournaments, tournament, pendingFixtures)
                }).catch(() => null);
            }
        } catch (error) {
            console.error('report collector error:', error);

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

async function getPendingFixtures(guildId, tournamentId) {
    return Fixture.find({
        guildId,
        tournamentId,
        status: { $in: ['Pending', 'Live'] }
    })
        .sort({
            scheduledAt: 1,
            matchNumber: 1,
            createdAt: 1
        })
        .limit(FIXTURE_LIMIT)
        .lean();
}

function buildMenuEmbed(tournament, fixtures) {
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
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Select a tournament, then select a fixture.\n\n` +
            fixtureList
        )
        .setFooter({
            text: `Showing ${fixtures.length}/${FIXTURE_LIMIT} nearest pending fixtures`
        })
        .setTimestamp();
}

function buildMenuComponents(tournaments, selectedTournament, fixtures) {
    const rows = [];

    rows.push(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('report_tournament')
                .setPlaceholder('Select tournament')
                .addOptions(
                    tournaments.slice(0, 25).map(tournament => ({
                        label: truncate(tournament.name || tournament.tournamentKey, 80),
                        description: `Key: ${tournament.tournamentKey}`,
                        value: tournament.tournamentKey,
                        default: tournament.tournamentKey === selectedTournament.tournamentKey
                    }))
                )
        )
    );

    if (fixtures.length) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('report_fixture')
                    .setPlaceholder('Select pending fixture')
                    .addOptions(
                        fixtures.slice(0, 25).map(fixture => ({
                            label: truncate(
                                `#${fixture.matchNumber} ${fixture.homeTeam} vs ${fixture.awayTeam}`,
                                100
                            ),
                            description: truncate(
                                fixture.roundLabel || prettyPhase(fixture.phase) || 'Pending fixture',
                                100
                            ),
                            value: String(fixture._id)
                        }))
                    )
            )
        );
    }

    return rows;
}

async function processFixtureReport({
    client,
    guild,
    tournament,
    fixtureId,
    homeScore,
    awayScore
}) {
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

    const winner =
        homeScore > awayScore
            ? fixture.homeTeam
            : awayScore > homeScore
                ? fixture.awayTeam
                : '';

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

    if (affectsStandings) {
        await applyTournamentTeamResult({
            fixture,
            tournament,
            homeScore,
            awayScore
        });
    }

    await updateAllLiveStandings(client, guild.id).catch(console.error);
    await updateLiveTopStats(client, guild.id).catch(console.error);

    await refreshLiveMasterSchedules(
        client,
        guild.id,
        tournament.tournamentKey
    ).catch(console.error);

    await refreshLiveBracket(
        client,
        guild.id,
        tournament.tournamentKey
    ).catch(console.error);

    if (global.io) {
        global.io.emit('update');
    }

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

async function applyTournamentTeamResult({
    fixture,
    tournament,
    homeScore,
    awayScore
}) {
    const homeEntry = await findTournamentTeamEntry({
        fixture,
        tournament,
        side: 'home'
    });

    const awayEntry = await findTournamentTeamEntry({
        fixture,
        tournament,
        side: 'away'
    });

    if (!homeEntry || !awayEntry) {
        throw new Error('Tournament team entries missing for fixture.');
    }

    const homeInc = buildTeamStatIncrement({
        goalsFor: homeScore,
        goalsAgainst: awayScore,
        tournament
    });

    const awayInc = buildTeamStatIncrement({
        goalsFor: awayScore,
        goalsAgainst: homeScore,
        tournament
    });

    await TournamentTeam.updateOne(
        { _id: homeEntry._id },
        { $inc: flattenTeamStatsIncrement(homeInc) }
    );

    await TournamentTeam.updateOne(
        { _id: awayEntry._id },
        { $inc: flattenTeamStatsIncrement(awayInc) }
    );
}

async function findTournamentTeamEntry({
    fixture,
    tournament,
    side
}) {
    const tournamentTeamId =
        side === 'home'
            ? fixture.homeTournamentTeamId
            : fixture.awayTournamentTeamId;

    const teamId =
        side === 'home'
            ? fixture.homeTeamId
            : fixture.awayTeamId;

    const teamName =
        side === 'home'
            ? fixture.homeTeam
            : fixture.awayTeam;

    if (tournamentTeamId) {
        const byTournamentTeamId = await TournamentTeam.findOne({
            _id: tournamentTeamId,
            guildId: fixture.guildId,
            tournamentId: tournament._id
        });

        if (byTournamentTeamId) return byTournamentTeamId;
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

function buildTeamStatIncrement({
    goalsFor,
    goalsAgainst,
    tournament
}) {
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

    return {
        played: 1,
        wins,
        draws,
        losses,
        gf: goalsFor,
        ga: goalsAgainst,
        points
    };
}

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

function parseScore(value) {
    const clean = String(value || '').trim();

    if (!/^\d+$/.test(clean)) return null;

    const number = Number(clean);

    if (!Number.isInteger(number) || number < 0) return null;

    return number;
}

function prettyPhase(phase) {
    const map = {
        league: 'League',
        group: 'Group Stage',
        qualifier: 'Qualifier',
        eliminator: 'Eliminator',
        quarterfinal: 'Quarter Final',
        semifinal: 'Semi Final',
        final: 'Final',
        custom: 'Custom'
    };

    return map[phase] || phase || 'Fixture';
}

function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
}