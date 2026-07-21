/**
 * generatestage.js
 *
 * Generate league, group, super8, or knockout fixtures for a tournament.
 * Validates teams, checks for existing fixtures, and creates match documents.
 *
 * Usage:  .generatestage [key] <league|groups|super8|knockout> [--force]
 * Slash:  /generatestage stage:<stage> [key] [force]
 *
 * Aliases: genstage, gst
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Fixture, TournamentTeam } = require('../../models/Tournament');
const { getDefaultTournament, getTournamentByKey } = require('../../utils/getTournament');
const { isOrganizer } = require('../../utils/isOrganizer');
const { prettyPhase } = require('../../utils/displayHelpers');
const { buildRoundRobinFixtures, buildKnockoutFixtures, getNextMatchNumber } = require('../../utils/fixtureBuilder');

module.exports = {
    name: 'generatestage',
    description: 'Generate league, group, super8, or knockout fixtures for a tournament.',
    usage: '.generatestage [key] <league|groups|super8|knockout> [--force]',
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
                    { name: 'Super 8', value: 'super8' },
                    { name: 'Knockout', value: 'knockout' }
                )
        )
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('Regenerate existing fixtures')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

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
            console.error('[generatestage] prefix error:', error);
            return message.reply('❌ Failed to generate stage.');
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

            return await runGenerate({
                guild: interaction.guild,
                key: interaction.options.getString('key')?.toLowerCase() || null,
                stage: interaction.options.getString('stage'),
                force: interaction.options.getBoolean('force') ?? false,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[generatestage] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to generate stage.');
            }

            return interaction.reply({ content: '❌ Failed to generate stage.', ephemeral: true });
        }
    }
};

/* ====================================================
   PREFIX ARG PARSER
==================================================== */

function parsePrefixArgs(args) {
    let key = null;
    let stage = null;
    let force = false;

    const validStages = ['league', 'groups', 'super8', 'knockout'];

    for (const arg of args) {
        if (arg === '--force') force = true;
        else if (validStages.includes(arg.toLowerCase())) stage = arg.toLowerCase();
        else if (!key) key = arg.toLowerCase();
    }

    if (!stage) {
        return {
            ok: false,
            error: '❌ Usage: `.generatestage [key] <league|groups|super8|knockout> [--force]`'
        };
    }

    return { ok: true, key, stage, force };
}

/* ====================================================
   CORE LOGIC
==================================================== */

/** Route to the appropriate generator based on stage type. */
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

    if (stage === 'league') return generateLeague({ guild, tournament, teams, force, reply });
    if (stage === 'groups') return generateGroups({ guild, tournament, teams, force, reply });
    if (stage === 'super8') return generateSuper8({ guild, tournament, teams, force, reply });
    if (stage === 'knockout') return generateKnockout({ guild, tournament, teams, force, reply });

    return reply({ content: '❌ Unknown stage type.' });
}

/* ====================================================
   LEAGUE GENERATOR
==================================================== */

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
        teams: normalizeTournamentTeams(teams),
        phase: 'league',
        roundPrefix: 'Matchday',
        groupKey: null,
        homeAway: tournament.homeAway,
        startMatchNumber: await getNextMatchNumber(guild.id, tournament._id)
    });

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'league';
    await tournament.save();

    return successReply(reply, tournament, 'LEAGUE GENERATED', fixtures.length);
}

/* ====================================================
   GROUP STAGE GENERATOR
==================================================== */

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

    /* -- Ensure all teams have group assignments -- */
    const unassigned = teams.filter(t => !t.groupKey);

    if (unassigned.length) {
        return reply({
            content:
                `❌ **${unassigned.length}** team(s) have no group assigned.\n` +
                `Use draw/group assignment first, then generate groups.`
        });
    }

    /* -- Generate round-robin per group -- */
    const groupKeys = Array.from(
        { length: tournament.groupCount },
        (_, i) => String.fromCharCode(65 + i)
    );

    const fixtures = [];
    let nextMatchNumber = await getNextMatchNumber(guild.id, tournament._id);

    for (const groupKey of groupKeys) {
        const groupTeams = teams.filter(t => t.groupKey === groupKey);
        if (groupTeams.length < 2) continue;

        const groupFixtures = buildRoundRobinFixtures({
            guildId: guild.id,
            tournament,
            teams: normalizeTournamentTeams(groupTeams),
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

    return successReply(reply, tournament, 'GROUP STAGE GENERATED', fixtures.length);
}

/* ====================================================
   SUPER 8 GENERATOR
   Club World Cup format: 8 qualified teams play single
   round-robin (7 games each). Random seeding.
==================================================== */

async function generateSuper8({ guild, tournament, teams, force, reply }) {
    if (tournament.formatType !== 'club_world_cup') {
        return reply({ content: '❌ Super 8 stage is only available for Club World Cup format tournaments.' });
    }

    const existing = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: 'super8'
    });

    if (existing && !force) {
        return reply({
            content: `❌ Super 8 fixtures already exist: **${existing}**. Use \`--force\` to regenerate.`
        });
    }

    if (existing && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id,
            phase: 'super8'
        });
    }

    /* -- Get qualified teams from group stage -- */
    const qualified = getGroupQualifiedTeams({ tournament, teams });

    if (qualified.length < 2) {
        return reply({
            content: `❌ Not enough qualified teams for Super 8: **${qualified.length}**. Play group stage first.`
        });
    }

    /* -- Random shuffle for seeding -- */
    shuffleArray(qualified);

    const fixtures = buildRoundRobinFixtures({
        guildId: guild.id,
        tournament,
        teams: qualified,
        phase: 'super8',
        roundPrefix: 'Super 8 Matchday',
        groupKey: null,
        homeAway: false,
        startMatchNumber: await getNextMatchNumber(guild.id, tournament._id)
    });

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'super8';
    await tournament.save();

    return successReply(reply, tournament, 'SUPER 8 GENERATED', fixtures.length);
}

/* ====================================================
   KNOCKOUT GENERATOR
==================================================== */

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

    /* -- Get qualified teams -- */
    let qualified;

    if (tournament.formatType === 'club_world_cup' && round === 'semifinal') {
        // For Club World Cup: top 4 from Super 8 → 1st vs 4th, 2nd vs 3rd
        qualified = getSuper8QualifiedTeams({ tournament, teams });
    } else {
        qualified = await getQualifiedTeams({ tournament, teams });
    }

    if (qualified.length < 2 || qualified.length % 2 !== 0) {
        return reply({
            content: `❌ Invalid qualified team count for **${prettyPhase(round)}**: **${qualified.length}**.`
        });
    }

    /* -- Pair up teams -- */
    const pairs = [];
    for (let i = 0; i < qualified.length; i += 2) {
        pairs.push([qualified[i], qualified[i + 1]]);
    }

    const isTwoLegged =
        Array.isArray(tournament.twoLeggedRounds) &&
        tournament.twoLeggedRounds.includes(round);

    const fixtures = buildKnockoutFixtures({
        guildId: guild.id,
        tournament,
        phase: round,
        pairs,
        twoLegged: isTwoLegged,
        startMatchNumber: await getNextMatchNumber(guild.id, tournament._id)
    });

    await Fixture.insertMany(fixtures);

    tournament.currentPhase = 'knockout';
    await tournament.save();

    return successReply(reply, tournament, `${prettyPhase(round).toUpperCase()} GENERATED`, fixtures.length);
}

/* ====================================================
   HELPERS
==================================================== */

/** Normalize TournamentTeam documents into the shape fixtureBuilder expects. */
function normalizeTournamentTeams(teams) {
    return teams.map(entry => ({
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));
}

/** Determine the next knockout round from tournament config or derived from qualified teams. */
function resolveNextKnockoutRound(tournament) {
    const rounds = Array.isArray(tournament.knockoutRounds)
        ? tournament.knockoutRounds
        : [];

    if (rounds.length > 0) return rounds[0];

    // Fallback: derive from qualified team count
    const qualifiedCount = deriveQualifiedCount(tournament);
    const derived = deriveKnockoutRounds(qualifiedCount);
    return derived[0] || 'semifinal';
}

/**
 * Derive the number of qualified teams from tournament settings.
 * For groups_knockout format: groupCount * qualificationSpotsPerGroup
 * For club_world_cup format: super8QualificationSpots (from Super 8 to semis)
 * Otherwise: teamCount or 4
 */
function deriveQualifiedCount(tournament) {
    if (tournament.formatType === 'club_world_cup') {
        return tournament.super8QualificationSpots || 4;
    }
    if (tournament.formatType === 'groups_knockout' && tournament.groupCount > 0) {
        return tournament.groupCount * (tournament.qualificationSpotsPerGroup || 2);
    }
    return tournament.teamCount || 4;
}

/**
 * Given the total number of qualified teams, return the
 * ordered array of knockout round phase strings.
 *
 * 2  -> ['final']
 * 4  -> ['semifinal', 'final']
 * 8  -> ['quarterfinal', 'semifinal', 'final']
 * 16 -> ['roundof16', 'quarterfinal', 'semifinal', 'final']
 */
function deriveKnockoutRounds(qualifiedTeamCount) {
    const ALL_ROUNDS = ['roundof16', 'quarterfinal', 'semifinal', 'final'];
    const total = Math.max(2, qualifiedTeamCount);

    const roundCount = Math.log2(total);
    const roundedCount = Math.ceil(roundCount);

    return ALL_ROUNDS.slice(ALL_ROUNDS.length - roundedCount);
}

/** Get qualified teams sorted by standings (points -> GD -> GF), with cross-group seeding. */
async function getQualifiedTeams({ tournament, teams }) {
    const groupKeys = [...new Set(teams.map(t => t.groupKey).filter(Boolean))].sort();
    const spotsPerGroup = tournament.qualificationSpotsPerGroup || 2;

    // If there are groups, qualify top N from each group with proper seeding
    if (groupKeys.length > 0) {
        return crossGroupSeed({ teams, groupKeys, spotsPerGroup });
    }

    // Fallback: flat standings -- take top N overall
    const sorted = [...teams].sort((a, b) => {
        const as = a.stats || {};
        const bs = b.stats || {};

        if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);

        const agd = (as.gf || 0) - (as.ga || 0);
        const bgd = (bs.gf || 0) - (bs.ga || 0);
        if (bgd !== agd) return bgd - agd;

        return (bs.gf || 0) - (as.gf || 0);
    });

    const target = deriveQualifiedCount(tournament);

    return sorted.slice(0, target).map(entry => ({
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));
}

/**
 * Get qualified teams from group stage for Club World Cup format.
 * Top N from each group (default 2), returned as flat list.
 * No cross-seeding needed since Super 8 is round-robin, not knockout.
 */
function getGroupQualifiedTeams({ tournament, teams }) {
    const groupKeys = [...new Set(teams.map(t => t.groupKey).filter(Boolean))].sort();
    const spotsPerGroup = tournament.qualificationSpotsPerGroup || 2;

    if (groupKeys.length === 0) {
        // No groups assigned yet -- return all teams sorted by stats
        const sorted = [...teams].sort((a, b) => {
            const as = a.stats || {};
            const bs = b.stats || {};
            if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);
            const agd = (as.gf || 0) - (as.ga || 0);
            const bgd = (bs.gf || 0) - (bs.ga || 0);
            if (bgd !== agd) return bgd - agd;
            return (bs.gf || 0) - (as.gf || 0);
        });

        return sorted.slice(0, 8).map(entry => ({
            tournamentTeamId: entry._id,
            teamId: entry.teamId?._id || entry.teamId,
            name: entry.teamId?.name || entry.teamNameSnapshot
        }));
    }

    const qualified = [];
    for (const groupKey of groupKeys) {
        const groupTeams = [...teams]
            .filter(t => t.groupKey === groupKey)
            .sort((a, b) => {
                const as = a.stats || {};
                const bs = b.stats || {};
                if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);
                const agd = (as.gf || 0) - (as.ga || 0);
                const bgd = (bs.gf || 0) - (bs.ga || 0);
                if (bgd !== agd) return bgd - agd;
                return (bs.gf || 0) - (as.gf || 0);
            })
            .slice(0, spotsPerGroup);

        for (const entry of groupTeams) {
            qualified.push({
                tournamentTeamId: entry._id,
                teamId: entry.teamId?._id || entry.teamId,
                name: entry.teamId?.name || entry.teamNameSnapshot
            });
        }
    }

    return qualified;
}

/**
 * Get top N from Super 8 standings for Club World Cup semifinals.
 * Sorted by points -> GD -> GF. Matchups: 1st vs 4th, 2nd vs 3rd.
 */
function getSuper8QualifiedTeams({ tournament, teams }) {
    const spots = tournament.super8QualificationSpots || 4;

    // Super 8 is a single table -- sort by standings
    const sorted = [...teams].sort((a, b) => {
        const as = a.stats || {};
        const bs = b.stats || {};
        if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);
        const agd = (as.gf || 0) - (as.ga || 0);
        const bgd = (bs.gf || 0) - (bs.ga || 0);
        if (bgd !== agd) return bgd - agd;
        return (bs.gf || 0) - (as.gf || 0);
    });

    const topN = sorted.slice(0, spots).map(entry => ({
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));

    // Pair: 1st vs 4th, 2nd vs 3rd
    if (topN.length === 4) {
        return [topN[0], topN[3], topN[1], topN[2]];
    }

    // Fallback for other counts: just pair sequentially
    return topN;
}

/**
 * Cross-group seeding: sort within each group, then interleave
 * so teams from the same group meet as late as possible.
 */
function crossGroupSeed({ teams, groupKeys, spotsPerGroup }) {
    const groups = {};
    for (const key of groupKeys) {
        groups[key] = teams
            .filter(t => t.groupKey === key)
            .sort((a, b) => {
                const as = a.stats || {};
                const bs = b.stats || {};
                if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);
                const agd = (as.gf || 0) - (as.ga || 0);
                const bgd = (bs.gf || 0) - (bs.ga || 0);
                if (bgd !== agd) return bgd - agd;
                return (bs.gf || 0) - (as.gf || 0);
            })
            .slice(0, spotsPerGroup)
            .map(entry => ({
                tournamentTeamId: entry._id,
                teamId: entry.teamId?._id || entry.teamId,
                name: entry.teamId?.name || entry.teamNameSnapshot
            }));
    }

    if (groupKeys.length === 1) {
        return groups[groupKeys[0]];
    }

    if (groupKeys.length === 2) {
        const [gA, gB] = groupKeys;
        const a = groups[gA] || [];
        const b = groups[gB] || [];

        const bracket = [];
        for (let i = 0; i < spotsPerGroup; i++) {
            if (a[i]) bracket.push(a[i]);
            if (b[spotsPerGroup - 1 - i]) bracket.push(b[spotsPerGroup - 1 - i]);
        }

        return bracket;
    }

    // 3+ groups: simple interleave
    const bracket = [];
    for (let pos = 0; pos < spotsPerGroup; pos++) {
        for (const key of groupKeys) {
            if (groups[key]?.[pos]) bracket.push(groups[key][pos]);
        }
    }

    return bracket;
}

/** Fisher-Yates shuffle in place. */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Build a success embed for fixture generation. */
function successReply(reply, tournament, title, count) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(title)
        .setDescription(
            `${tournament.emoji || ''} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Created fixtures: **${count}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
