/**
 * generatestage.js
 *
 * Generate fixtures for any tournament stage. Fully auto:
 *   - Groups: auto-assigns groups if teams have none, then generates round-robin
 *   - Super 8: auto-picks group qualifiers, random seeds, generates round-robin
 *   - Knockout: auto-picks from standings, figures out which round is next
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
    description: 'Generate tournament stage fixtures.',
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
   Auto-assigns groups if teams have no groupKey yet.
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

    /* -- Auto-assign groups if teams don't have them -- */
    const unassigned = teams.filter(t => !t.groupKey);

    if (unassigned.length) {
        await autoAssignGroups(guild.id, tournament._id, teams, tournament.groupCount);
        // Reload teams with fresh groupKey
        const refreshed = await TournamentTeam.find({
            guildId: guild.id,
            tournamentId: tournament._id,
            isActive: true
        }).populate('teamId').sort({ createdAt: 1 });

        teams.length = 0;
        teams.push(...refreshed);
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

    const autoNote = unassigned.length
        ? `\nAuto-assigned **${unassigned.length}** teams into groups.`
        : '';

    return successReply(reply, tournament, 'GROUP STAGE GENERATED', fixtures.length, autoNote);
}

/* ====================================================
   SUPER 8 GENERATOR
   Auto-picks qualifiers from group standings,
   random seeds, single round-robin.
==================================================== */

async function generateSuper8({ guild, tournament, teams, force, reply }) {
    if (tournament.formatType !== 'club_world_cup') {
        return reply({ content: '❌ Super 8 stage is only for Club World Cup format.' });
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
            content: `❌ Not enough qualified teams: **${qualified.length}**. Play group stage first.`
        });
    }

    /* -- Random shuffle -- */
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

    const teamList = qualified.map(t => t.name).join(', ');

    return successReply(
        reply, tournament, 'SUPER 8 GENERATED', fixtures.length,
        `\nQualified teams: **${teamList}**`
    );
}

/* ====================================================
   KNOCKOUT GENERATOR
   Fully auto: figures out which round to generate next.
   - No knockout fixtures yet → creates first round (semis for CWC)
   - Semis played → creates final from winners
   - Any earlier round played → creates next round from winners
==================================================== */

async function generateKnockout({ guild, tournament, teams, force, reply }) {
    if (!tournament.hasKnockout) {
        return reply({ content: '❌ This tournament has no knockout stage enabled.' });
    }

    const knockoutRounds = Array.isArray(tournament.knockoutRounds)
        ? tournament.knockoutRounds
        : [];

    /* -- Figure out which round to generate -- */
    const round = resolveNextKnockoutRound(guild.id, tournament, knockoutRounds);

    if (!round) {
        return reply({ content: '❌ No more knockout rounds to generate.' });
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
        qualified = getSuper8QualifiedTeams({ tournament, teams });
    } else if (round === 'semifinal' || round === 'quarterfinal' || round === 'roundof16') {
        // First knockout round from group/league standings
        qualified = getStandingsQualifiedTeams({ tournament, teams });
    } else {
        // Later knockout round — get winners from previous round
        const prevRound = getPreviousRound(knockoutRounds, round);
        if (prevRound) {
            qualified = await getWinnersFromRound({ guild, tournament, phase: prevRound });
        } else {
            qualified = getStandingsQualifiedTeams({ tournament, teams });
        }
    }

    if (qualified.length < 2 || qualified.length % 2 !== 0) {
        return reply({
            content: `❌ Invalid qualified team count for **${prettyPhase(round)}**: **${qualified.length}**.` +
                (round !== knockoutRounds[0] ? '\nMake sure the previous round is fully played.' : '')
        });
    }

    /* -- Pair up -- */
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
   AUTO GROUP ASSIGNMENT
==================================================== */

/** Snake-draft teams into groups. Same logic as autofixtures. */
async function autoAssignGroups(guildId, tournamentId, teams, groupCount) {
    const groupKeys = Array.from(
        { length: groupCount },
        (_, i) => String.fromCharCode(65 + i)
    );

    const shuffled = [...teams].sort(() => Math.random() - 0.5);

    let direction = 1;
    let groupIndex = 0;

    for (const team of shuffled) {
        const groupKey = groupKeys[groupIndex];

        await TournamentTeam.updateOne(
            { _id: team._id },
            { $set: { groupKey } }
        );

        groupIndex += direction;

        if (groupIndex >= groupKeys.length) {
            groupIndex = groupKeys.length - 1;
            direction = -1;
        } else if (groupIndex < 0) {
            groupIndex = 0;
            direction = 1;
        }
    }
}

/* ====================================================
   ROUND RESOLUTION
==================================================== */

/**
 * Figure out which knockout round to generate next.
 * - If no knockout fixtures exist at all → first round
 * - If a round is fully played and next round has no fixtures → next round
 * - If all rounds done → null
 */
/**
 * Resolve which round to actually generate RIGHT NOW.
 * Checks which rounds already have fixtures, which are fully played.
 */
async function resolveNextKnockoutRound(guildId, tournament, knockoutRounds) {
    const rounds = knockoutRounds.length > 0
        ? [...knockoutRounds]
        : deriveKnockoutRounds(
            tournament.formatType === 'club_world_cup'
                ? (tournament.super8QualificationSpots || 4)
                : deriveQualifiedCount(tournament)
        );

    if (!rounds.length) return null;

    for (const round of rounds) {
        const existing = await Fixture.countDocuments({
            guildId,
            tournamentId: tournament._id,
            phase: round
        });

        // No fixtures for this round yet → this is the one to generate
        if (existing === 0) {
            // But first check: is there a previous round that's not played yet?
            const roundIndex = rounds.indexOf(round);
            if (roundIndex > 0) {
                const prevRound = rounds[roundIndex - 1];
                const prevUnplayed = await Fixture.countDocuments({
                    guildId,
                    tournamentId: tournament._id,
                    phase: prevRound,
                    status: { $ne: 'Played' }
                });
                if (prevUnplayed > 0) {
                    return null; // Previous round not done yet
                }
            }
            return round;
        }

        // Fixtures exist — check if they're all played
        const unplayed = await Fixture.countDocuments({
            guildId,
            tournamentId: tournament._id,
            phase: round,
            status: { $ne: 'Played' }
        });

        if (unplayed > 0) {
            return null; // This round isn't done yet
        }

        // This round is fully played → continue to next round
    }

    return null; // All rounds done
}

/** Get the round before the given one in the knockout rounds array. */
function getPreviousRound(knockoutRounds, currentRound) {
    const idx = knockoutRounds.indexOf(currentRound);
    if (idx <= 0) return null;
    return knockoutRounds[idx - 1];
}

/* ====================================================
   TEAM QUALIFICATION
==================================================== */

/** Normalize TournamentTeam docs for fixture builder. */
function normalizeTournamentTeams(teams) {
    return teams.map(entry => ({
        tournamentTeamId: entry._id,
        teamId: entry.teamId?._id || entry.teamId,
        name: entry.teamId?.name || entry.teamNameSnapshot
    }));
}

/** Derive qualified team count from tournament settings. */
function deriveQualifiedCount(tournament) {
    if (tournament.formatType === 'club_world_cup') {
        return tournament.super8QualificationSpots || 4;
    }
    if (tournament.formatType === 'groups_knockout' && tournament.groupCount > 0) {
        return tournament.groupCount * (tournament.qualificationSpotsPerGroup || 2);
    }
    return tournament.teamCount || 4;
}

/** Derive knockout rounds from qualified team count. */
function deriveKnockoutRounds(qualifiedTeamCount) {
    const ALL_ROUNDS = ['roundof16', 'quarterfinal', 'semifinal', 'final'];
    const total = Math.max(2, qualifiedTeamCount);
    const roundedCount = Math.ceil(Math.log2(total));
    return ALL_ROUNDS.slice(ALL_ROUNDS.length - roundedCount);
}

/** Sort teams by standings: points desc, GD desc, GF desc. */
function sortByStandings(teams) {
    return [...teams].sort((a, b) => {
        const as = a.stats || {};
        const bs = b.stats || {};
        if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);
        const agd = (as.gf || 0) - (as.ga || 0);
        const bgd = (bs.gf || 0) - (bs.ga || 0);
        if (bgd !== agd) return bgd - agd;
        return (bs.gf || 0) - (as.gf || 0);
    });
}

/** Get qualified teams from group standings (for Super 8 entry). */
function getGroupQualifiedTeams({ tournament, teams }) {
    const groupKeys = [...new Set(teams.map(t => t.groupKey).filter(Boolean))].sort();
    const spotsPerGroup = tournament.qualificationSpotsPerGroup || 2;

    if (groupKeys.length === 0) {
        return normalizeTournamentTeams(
            sortByStandings(teams).slice(0, 8)
        );
    }

    const qualified = [];
    for (const groupKey of groupKeys) {
        const groupTeams = sortByStandings(
            teams.filter(t => t.groupKey === groupKey)
        ).slice(0, spotsPerGroup);

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

/** Get top N from Super 8 for Club World Cup semis. 1v4, 2v3. */
function getSuper8QualifiedTeams({ tournament, teams }) {
    const spots = tournament.super8QualificationSpots || 4;
    const sorted = sortByStandings(teams);
    const topN = normalizeTournamentTeams(sorted.slice(0, spots));

    if (topN.length === 4) {
        return [topN[0], topN[3], topN[1], topN[2]];
    }

    return topN;
}

/** Get qualified teams from flat standings (for groups_knockout first round). */
function getStandingsQualifiedTeams({ tournament, teams }) {
    const groupKeys = [...new Set(teams.map(t => t.groupKey).filter(Boolean))].sort();
    const spotsPerGroup = tournament.qualificationSpotsPerGroup || 2;

    if (groupKeys.length > 0) {
        return crossGroupSeed({ teams, groupKeys, spotsPerGroup });
    }

    const target = deriveQualifiedCount(tournament);
    return normalizeTournamentTeams(sortByStandings(teams).slice(0, target));
}

/** Get winners from a completed knockout round. */
async function getWinnersFromRound({ guild, tournament, phase }) {
    const fixtures = await Fixture.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase,
        status: 'Played'
    }).sort({ matchNumber: 1 });

    const winners = [];

    for (const fixture of fixtures) {
        const winner = determineFixtureWinner(fixture);
        if (!winner) continue;

        const entry = await TournamentTeam.findOne({
            _id: winner.tournamentTeamId,
            guildId: guild.id,
            tournamentId: tournament._id
        }).populate('teamId');

        if (entry?.teamId) {
            winners.push({
                tournamentTeamId: entry._id,
                teamId: entry.teamId._id,
                name: entry.teamId.name || entry.teamNameSnapshot
            });
        }
    }

    return winners;
}

/** Determine winner of a played fixture. Returns { tournamentTeamId, teamId } or null. */
function determineFixtureWinner(fixture) {
    const result = fixture.result || {};

    // Explicit winner field
    if (result.winner) {
        const winnerName = result.winner.trim().toLowerCase();
        if (fixture.homeTeam?.trim().toLowerCase() === winnerName) {
            return { tournamentTeamId: fixture.homeTournamentTeamId, teamId: fixture.homeTeamId };
        }
        if (fixture.awayTeam?.trim().toLowerCase() === winnerName) {
            return { tournamentTeamId: fixture.awayTournamentTeamId, teamId: fixture.awayTeamId };
        }
    }

    const homeGoals = Number(result.home ?? 0);
    const awayGoals = Number(result.away ?? 0);

    if (homeGoals > awayGoals) {
        return { tournamentTeamId: fixture.homeTournamentTeamId, teamId: fixture.homeTeamId };
    }
    if (awayGoals > homeGoals) {
        return { tournamentTeamId: fixture.awayTournamentTeamId, teamId: fixture.awayTeamId };
    }

    // Check penalties
    const homePens = result.penaltiesHome;
    const awayPens = result.penaltiesAway;

    if (homePens != null && awayPens != null) {
        if (homePens > awayPens) {
            return { tournamentTeamId: fixture.homeTournamentTeamId, teamId: fixture.homeTeamId };
        }
        if (awayPens > homePens) {
            return { tournamentTeamId: fixture.awayTournamentTeamId, teamId: fixture.awayTeamId };
        }
    }

    return null;
}

/**
 * Cross-group seeding for knockout brackets.
 * Sorts within each group, then interleaves so same-group teams meet late.
 */
function crossGroupSeed({ teams, groupKeys, spotsPerGroup }) {
    const groups = {};
    for (const key of groupKeys) {
        groups[key] = sortByStandings(
            teams.filter(t => t.groupKey === key)
        ).slice(0, spotsPerGroup);

        groups[key] = groups[key].map(entry => ({
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

/* ====================================================
   UTILITIES
==================================================== */

/** Fisher-Yates shuffle. */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Build success embed. */
function successReply(reply, tournament, title, count, extra = '') {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(title)
        .setDescription(
            `${tournament.emoji || ''} **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Created fixtures: **${count}**${extra}`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
