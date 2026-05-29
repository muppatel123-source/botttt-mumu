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
    getDefaultTournament,
    getTournamentByKey
} = require('../../utils/getTournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'generatestage',
    description: 'Generate league, group, or knockout fixtures for a tournament.',
    usage: '.generatestage [key] <league|groups|knockout> [--force]',
    aliases: ['genstage', 'gst'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('generatestage')
        .setDescription('Generate tournament stage')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('stage')
                .setDescription('Stage to generate')
                .setRequired(true)
                .addChoices(
                    { name: 'League', value: 'league' },
                    { name: 'Groups', value: 'groups' },
                    { name: 'Knockout', value: 'knockout' }
                )
        )
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('Regenerate existing fixtures')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const parsed = parsePrefixArgs(args);
            if (!parsed.ok) return message.reply(parsed.error);

            return await runGenerate({
                guild: message.guild,
                ...parsed,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('generatestage prefix error:', error);
            return message.reply('❌ Failed to generate stage.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runGenerate({
                guild: interaction.guild,
                key: interaction.options.getString('key')?.toLowerCase() || null,
                stage: interaction.options.getString('stage'),
                force: interaction.options.getBoolean('force') ?? false,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('generatestage slash error:', error);
            return interaction.editReply('❌ Failed to generate stage.');
        }
    }
};

function parsePrefixArgs(args) {
    let key = null;
    let stage = null;
    let force = false;

    for (const arg of args) {
        if (arg === '--force') force = true;
        else if (['league', 'groups', 'knockout'].includes(arg.toLowerCase())) stage = arg.toLowerCase();
        else if (!key) key = arg.toLowerCase();
    }

    if (!stage) {
        return {
            ok: false,
            error: '❌ Usage: `.generatestage [key] <league|groups|knockout> [--force]`'
        };
    }

    return { ok: true, key, stage, force };
}

async function runGenerate({ guild, key, stage, force, reply }) {
    const tournament = key
        ? await getTournamentByKey(guild.id, key)
        : await getDefaultTournament(guild.id);

    if (!tournament) return reply({ content: '❌ Tournament not found.' });

    const teams = await TournamentTeam.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        isActive: true
    }).populate('teamId').sort({ createdAt: 1 });

    if (teams.length < 2) {
        return reply({ content: '❌ At least 2 active teams are required.' });
    }

    if (stage === 'league') {
        return generateLeague({ guild, tournament, teams, force, reply });
    }

    if (stage === 'groups') {
        return generateGroups({ guild, tournament, teams, force, reply });
    }

    if (stage === 'knockout') {
        return generateKnockout({ guild, tournament, teams, force, reply });
    }
}

async function generateLeague({ guild, tournament, teams, force, reply }) {
    const existing = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: 'league'
    });

    if (existing && !force) {
        return reply({
            content: `❌ League fixtures already exist: **${existing}**. Use \`--force\` to regenerate.`
        });
    }

    if (existing && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase: 'league'
        });
    }

    const fixtures = buildRoundRobinFixtures({
        guildId: guild.id,
        tournament,
        teams,
        phase: 'league',
        roundPrefix: 'Matchday',
        groupKey: null,
        homeAway: tournament.homeAway,
        startMatchNumber: await getNextMatchNumber(guild.id, tournament._id)
    });

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'league';
    await tournament.save();

    return successReply(reply, tournament, '🏟️ LEAGUE GENERATED', fixtures.length);
}

async function generateGroups({ guild, tournament, teams, force, reply }) {
    if (!tournament.groupCount || tournament.groupCount <= 0) {
        return reply({ content: '❌ This tournament has no groups configured.' });
    }

    const existing = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: 'group'
    });

    if (existing && !force) {
        return reply({
            content: `❌ Group fixtures already exist: **${existing}**. Use \`--force\` to regenerate.`
        });
    }

    if (existing && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase: 'group'
        });
    }

    const groupKeys = Array.from(
        { length: tournament.groupCount },
        (_, i) => String.fromCharCode(65 + i)
    );

    const unassigned = teams.filter(t => !t.groupKey);

    if (unassigned.length) {
        return reply({
            content:
                `❌ **${unassigned.length}** team(s) have no group assigned.\n` +
                `Use draw/group assignment first, then generate groups.`
        });
    }

    const fixtures = [];
    let nextMatchNumber = await getNextMatchNumber(guild.id, tournament._id);

    for (const groupKey of groupKeys) {
        const groupTeams = teams.filter(t => t.groupKey === groupKey);
        if (groupTeams.length < 2) continue;

        const groupFixtures = buildRoundRobinFixtures({
            guildId: guild.id,
            tournament,
            teams: groupTeams,
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
        return reply({ content: '❌ No group fixtures could be generated.' });
    }

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'groups';
    await tournament.save();

    return successReply(reply, tournament, '📦 GROUP STAGE GENERATED', fixtures.length);
}

async function generateKnockout({ guild, tournament, teams, force, reply }) {
    if (!tournament.hasKnockout) {
        return reply({ content: '❌ This tournament has no knockout stage enabled.' });
    }

    const round = resolveNextKnockoutRound(tournament);

    if (!round) {
        return reply({ content: '❌ No knockout round found in tournament settings.' });
    }

    const existing = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: round
    });

    if (existing && !force) {
        return reply({
            content: `❌ ${prettyPhase(round)} fixtures already exist: **${existing}**. Use \`--force\`.`
        });
    }

    if (existing && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase: round
        });
    }

    const qualified = await getQualifiedTeams({
        guildId: guild.id,
        tournament,
        teams,
        round
    });

    if (qualified.length < 2 || qualified.length % 2 !== 0) {
        return reply({
            content:
                `❌ Invalid qualified team count for **${prettyPhase(round)}**: **${qualified.length}**.`
        });
    }

    const pairs = [];
    for (let i = 0; i < qualified.length; i += 2) {
        pairs.push([qualified[i], qualified[i + 1]]);
    }

    const fixtures = buildKnockoutFixtures({
        guildId: guild.id,
        tournament,
        phase: round,
        pairs,
        twoLegged: Array.isArray(tournament.twoLeggedRounds) && tournament.twoLeggedRounds.includes(round),
        startMatchNumber: await getNextMatchNumber(guild.id, tournament._id)
    });

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'knockout';
    await tournament.save();

    return successReply(reply, tournament, `🏆 ${prettyPhase(round).toUpperCase()} GENERATED`, fixtures.length);
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
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));

    if (list.length % 2 !== 0) list.push({ name: '__BYE__' });

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

function resolveNextKnockoutRound(tournament) {
    const rounds = Array.isArray(tournament.knockoutRounds)
        ? tournament.knockoutRounds
        : [];

    return rounds[0] || 'semifinal';
}

async function getQualifiedTeams({ tournament, teams }) {
    const sorted = [...teams].sort((a, b) => {
        const as = a.stats || {};
        const bs = b.stats || {};

        if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);

        const agd = (as.gf || 0) - (as.ga || 0);
        const bgd = (bs.gf || 0) - (bs.ga || 0);
        if (bgd !== agd) return bgd - agd;

        return (bs.gf || 0) - (as.gf || 0);
    });

    const target =
        tournament.knockoutTeamCount ||
        tournament.qualifiedTeamCount ||
        4;

    return sorted.slice(0, target).map(entry => ({
        _id: entry._id,
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));
}

async function getNextMatchNumber(guildId, tournamentId) {
    const latest = await Fixture.findOne({
        guildId,
        tournamentId
    }).sort({ matchNumber: -1 }).select('matchNumber');

    return latest ? latest.matchNumber + 1 : 1;
}

function successReply(reply, tournament, title, count) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(title)
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Created fixtures: **${count}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

function extractRoundNumber(label) {
    const match = String(label || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
}

function prettyPhase(phase) {
    const map = {
        league: 'League',
        group: 'Group',
        qualifier: 'Qualifier',
        eliminator: 'Eliminator',
        quarterfinal: 'Quarter Final',
        semifinal: 'Semi Final',
        final: 'Final'
    };

    return map[phase] || phase;
}