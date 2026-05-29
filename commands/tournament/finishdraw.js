const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Fixture,
    TournamentTeam
} = require('../../models/Tournament');

const {
    getDrawKey,
    updatePublicDrawBoard,
    prettyPhase
} = require('../../utils/drawBoard');

const {
    getDefaultTournament,
    getTournamentByKey
} = require('../../utils/getTournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'finishdraw',
    description: 'Finish the active draw and generate fixtures.',
    usage: '.finishdraw [tournamentKey] [--force]',
    aliases: ['enddraw', 'closedraw'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('finishdraw')
        .setDescription('Finish the active draw and generate fixtures')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('Force finish even if validation is not fully satisfied')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const parsed = parsePrefixArgs(args);

            return await runFinishDraw({
                client: message.client,
                guild: message.guild,
                userId: message.author.id,
                key: parsed.key,
                force: parsed.force,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('finishdraw prefix error:', error);
            return message.reply('❌ Failed to finish draw.');
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

            return await runFinishDraw({
                client: interaction.client,
                guild: interaction.guild,
                userId: interaction.user.id,
                key: interaction.options.getString('key')?.toLowerCase() || null,
                force: interaction.options.getBoolean('force') ?? false,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('finishdraw slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to finish draw.');
            }

            return interaction.reply({
                content: '❌ Failed to finish draw.',
                ephemeral: true
            });
        }
    }
};

function parsePrefixArgs(args) {
    let key = null;
    let force = false;

    for (const arg of args) {
        if (arg === '--force') force = true;
        else if (!key) key = arg.toLowerCase();
    }

    return { key, force };
}

async function runFinishDraw({
    client,
    guild,
    userId,
    key,
    force,
    reply
}) {
    const tournament = key
        ? await getTournamentByKey(guild.id, key)
        : await getDefaultTournament(guild.id);

    if (!tournament) {
        return reply({
            content: '❌ Tournament not found.'
        });
    }

    const drawKey = getDrawKey(guild.id);
    const session = client.liveSettings.get(drawKey);

    if (!session || session.type !== 'manual_draw') {
        return reply({
            content: '❌ No active draw session found.'
        });
    }

    if (session.tournamentKey && session.tournamentKey !== tournament.tournamentKey) {
        return reply({
            content:
                `❌ Active draw belongs to \`${session.tournamentKey}\`, not \`${tournament.tournamentKey}\`.`
        });
    }

    if (session.startedBy !== userId && !force) {
        return reply({
            content:
                '🚫 Only the organizer who started the draw can finish it.\n' +
                'Use `--force` only if intentional.'
        });
    }

    if (session.stage === 'groups') {
        return finishGroupDraw({
            client,
            guild,
            drawKey,
            session,
            tournament,
            force,
            reply
        });
    }

    if (session.stage === 'knockout') {
        return finishKnockoutDraw({
            client,
            guild,
            drawKey,
            session,
            tournament,
            force,
            reply
        });
    }

    return reply({
        content: '❌ Unknown draw stage.'
    });
}

async function finishGroupDraw({
    client,
    guild,
    drawKey,
    session,
    tournament,
    force,
    reply
}) {
    const validation = validateGroupDraw(session);

    if (!validation.ok && !force) {
        return reply({
            content:
                `❌ ${validation.error}\n` +
                `Use \`--force\` only if intentional.`
        });
    }

    const existingGroupFixtures = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: 'group'
    });

    if (existingGroupFixtures > 0 && !force) {
        return reply({
            content:
                `❌ Group fixtures already exist for \`${tournament.tournamentKey}\` ` +
                `(**${existingGroupFixtures}** found).\n` +
                `Use \`--force\` to regenerate.`
        });
    }

    if (existingGroupFixtures > 0 && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase: 'group'
        });
    }

    const fixtures = [];
    let nextMatchNumber = await getNextMatchNumber(guild.id, tournament._id);

    for (const [groupKey, drawnTeams] of Object.entries(session.groups || {})) {
        if (drawnTeams.length < 2) continue;

        const tournamentTeams = [];

        for (const drawnTeam of drawnTeams) {
            const entry = await resolveTournamentTeamFromDraw({
                guildId: guild.id,
                tournamentId: tournament._id,
                drawnTeam,
                groupKey
            });

            if (entry) tournamentTeams.push(entry);
        }

        if (tournamentTeams.length < 2) continue;

        const groupFixtures = buildRoundRobinFixtures({
            guildId: guild.id,
            tournament,
            teams: tournamentTeams,
            phase: 'group',
            roundPrefix: `Group ${groupKey} Matchday`,
            groupKey,
            homeAway: tournament.homeAway,
            startMatchNumber: nextMatchNumber
        });

        nextMatchNumber += groupFixtures.length;
        fixtures.push(...groupFixtures);
    }

    if (!fixtures.length) {
        return reply({
            content: '❌ No group fixtures could be generated from this draw.'
        });
    }

    await Fixture.insertMany(fixtures);

    session.status = 'completed';
    session.completedAt = Date.now();
    session.completionNotes = {
        fixtureCount: fixtures.length,
        stage: 'groups',
        tournamentKey: tournament.tournamentKey
    };

        await updatePublicDrawBoard(client, session).catch(() => null);

    client.liveSettings.set(drawKey, session);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ GROUP DRAW FINISHED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Generated group fixtures successfully.`
        )
        .addFields(
            {
                name: 'Groups',
                value:
                    Object.entries(session.groups || {})
                        .map(([group, teams]) =>
                            `**Group ${group}:** ${teams.length} teams`
                        )
                        .join('\n') || 'None',
                inline: false
            },
            {
                name: 'Fixtures Generated',
                value: `**${fixtures.length}**`,
                inline: true
            }
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

async function finishKnockoutDraw({
    client,
    guild,
    drawKey,
    session,
    tournament,
    force,
    reply
}) {
    const pairs = session.knockoutPairs || [];

    if (!pairs.length) {
        return reply({
            content: '❌ No knockout pairings found.'
        });
    }

    const phase = session.knockoutPhase || 'quarterfinal';

    const existing = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase
    });

    if (existing > 0 && !force) {
        return reply({
            content:
                `❌ ${prettyPhase(phase)} fixtures already exist ` +
                `(**${existing}** found).\n` +
                `Use \`--force\` to regenerate.`
        });
    }

    if (existing > 0 && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase
        });
    }

    const resolvedPairs = [];

    for (const pair of pairs) {
        const home = await resolveTournamentTeamFromDraw({
            guildId: guild.id,
            tournamentId: tournament._id,
            drawnTeam: pair.home
        });

        const away = await resolveTournamentTeamFromDraw({
            guildId: guild.id,
            tournamentId: tournament._id,
            drawnTeam: pair.away
        });

        if (!home || !away) continue;

        resolvedPairs.push([home, away]);
    }

    if (!resolvedPairs.length) {
        return reply({
            content: '❌ Could not resolve tournament teams from knockout draw.'
        });
    }

    const fixtures = buildKnockoutFixtures({
        guildId: guild.id,
        tournament,
        phase,
        pairs: resolvedPairs,
        twoLegged:
            Array.isArray(tournament.twoLeggedRounds) &&
            tournament.twoLeggedRounds.includes(phase),

        startMatchNumber:
            await getNextMatchNumber(
                guild.id,
                tournament._id
            )
    });

    await Fixture.insertMany(fixtures);

    session.status = 'completed';
    session.completedAt = Date.now();
    session.completionNotes = {
        fixtureCount: fixtures.length,
        stage: 'knockout',
        tournamentKey: tournament.tournamentKey
    };

    await updatePublicDrawBoard(client, session).catch(() => null);

    client.liveSettings.set(drawKey, session);

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏆 KNOCKOUT DRAW FINISHED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Generated ${prettyPhase(phase)} fixtures successfully.`
        )
        .addFields(
            {
                name: 'Pairings',
                value:
                    resolvedPairs
                        .map(
                            ([h, a]) =>
                                `• ${h.teamId?.name || h.teamNameSnapshot} vs ${a.teamId?.name || a.teamNameSnapshot}`
                        )
                        .join('\n') || 'None',
                inline: false
            },
            {
                name: 'Fixtures Generated',
                value: `**${fixtures.length}**`,
                inline: true
            }
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

function validateGroupDraw(session) {
    const groups = session.groups || {};

    const sizes = Object.values(groups).map(v => v.length);

    if (!sizes.length) {
        return {
            ok: false,
            error: 'No groups found in draw session.'
        };
    }

    const min = Math.min(...sizes);
    const max = Math.max(...sizes);

    if (max - min > 1) {
        return {
            ok: false,
            error: 'Group sizes are uneven.'
        };
    }

    return { ok: true };
}

async function resolveTournamentTeamFromDraw({
    guildId,
    tournamentId,
    drawnTeam,
    groupKey = null
}) {
    const teamId =
        drawnTeam.teamId ||
        drawnTeam._id ||
        drawnTeam.id;

    if (!teamId) return null;

    const entry = await TournamentTeam.findOne({
        guildId,
        tournamentId,
        teamId,
        isActive: true
    }).populate('teamId');

    if (!entry) return null;

    if (groupKey) {
        entry.groupKey = groupKey;
        await entry.save();
    }

    return {
        _id: entry._id,
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        teamNameSnapshot:
            entry.teamId?.name ||
            entry.teamNameSnapshot,
        name:
            entry.teamId?.name ||
            entry.teamNameSnapshot
    };
}

async function getNextMatchNumber(
    guildId,
    tournamentId
) {
    const latest = await Fixture.findOne({
        guildId,
        tournamentId
    })
        .sort({ matchNumber: -1 })
        .select('matchNumber');

    return latest ? latest.matchNumber + 1 : 1;
}

function buildRoundRobinFixtures({
    guildId,
    tournament,
    teams,
    phase,
    roundPrefix,
    groupKey,
    homeAway,
    startMatchNumber
}) {
    const list = teams.map(entry => ({
        tournamentTeamId: entry.tournamentTeamId || entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.name || entry.teamNameSnapshot || entry.teamId?.name
    }));

    if (list.length % 2 !== 0) {
        list.push({ name: '__BYE__' });
    }

    const totalRounds = list.length - 1;
    const half = list.length / 2;
    let rotation = [...list];

    const fixtures = [];
    let matchNumber = startMatchNumber;

    for (let round = 0; round < totalRounds; round++) {
        for (let i = 0; i < half; i++) {
            const home = rotation[i];
            const away = rotation[rotation.length - 1 - i];

            if (home.name === '__BYE__' || away.name === '__BYE__') continue;

            fixtures.push(buildFixture({
                guildId,
                tournament,
                phase,
                groupKey,
                roundLabel: `${roundPrefix} ${round + 1}`,
                matchNumber: matchNumber++,
                home,
                away
            }));
        }

        const fixed = rotation[0];
        const rest = rotation.slice(1);
        rest.unshift(rest.pop());
        rotation = [fixed, ...rest];
    }

    if (homeAway) {
        const firstLeg = [...fixtures];

        for (const fixture of firstLeg) {
            fixtures.push(buildFixture({
                guildId,
                tournament,
                phase,
                groupKey,
                roundLabel: `${roundPrefix} ${extractRoundNumber(fixture.roundLabel) + totalRounds}`,
                matchNumber: matchNumber++,
                home: {
                    tournamentTeamId: fixture.awayTournamentTeamId,
                    teamId: fixture.awayTeamId,
                    name: fixture.awayTeam
                },
                away: {
                    tournamentTeamId: fixture.homeTournamentTeamId,
                    teamId: fixture.homeTeamId,
                    name: fixture.homeTeam
                }
            }));
        }
    }

    return fixtures;
}

function buildKnockoutFixtures({
    guildId,
    tournament,
    phase,
    pairs,
    twoLegged,
    startMatchNumber
}) {
    const fixtures = [];
    let matchNumber = startMatchNumber;

    for (let i = 0; i < pairs.length; i++) {
        const [home, away] = pairs[i];
        const roundLabel = `${prettyPhase(phase)} ${i + 1}`;
        const tieKey = `${tournament.tournamentKey}_${phase}_${i + 1}`;

        fixtures.push(buildFixture({
            guildId,
            tournament,
            phase,
            groupKey: null,
            roundLabel,
            matchNumber: matchNumber++,
            home,
            away,
            aggregateTieKey: twoLegged ? tieKey : null,
            leg: 1
        }));

        if (twoLegged) {
            fixtures.push(buildFixture({
                guildId,
                tournament,
                phase,
                groupKey: null,
                roundLabel,
                matchNumber: matchNumber++,
                home: away,
                away: home,
                aggregateTieKey: tieKey,
                leg: 2
            }));
        }
    }

    return fixtures;
}

function buildFixture({
    guildId,
    tournament,
    phase,
    groupKey,
    roundLabel,
    matchNumber,
    home,
    away,
    aggregateTieKey = null,
    leg = 1
}) {
    return {
        guildId,
        tournamentId: tournament._id,
        tournamentKey: tournament.tournamentKey,

        phase,
        roundLabel,
        groupKey,
        leg,
        matchNumber,

        homeTeam: home.name,
        awayTeam: away.name,

        homeTeamId: home.teamId || null,
        awayTeamId: away.teamId || null,

        homeTournamentTeamId: home.tournamentTeamId || home._id || null,
        awayTournamentTeamId: away.tournamentTeamId || away._id || null,

        venueType: phase === 'final' && tournament.finalNeutralVenue ? 'neutral' : 'home',
        venueName: phase === 'final' && tournament.finalNeutralVenue ? 'Neutral Ground' : 'Home Ground',

        scheduledAt: null,
        status: 'Pending',

        result: {
            home: null,
            away: null,
            extraTimeHome: null,
            extraTimeAway: null,
            penaltiesHome: null,
            penaltiesAway: null,
            winner: ''
        },

        aggregateTieKey,
        notes: leg > 1 ? `${roundLabel} (Leg ${leg})` : '',

        bracket: {
            advancesToMatchNumber: null,
            slot: ''
        }
    };
}

function extractRoundNumber(label) {
    const match = String(label || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
}