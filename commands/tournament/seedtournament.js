/**
 * seedtournament.js
 *
 * Seed fake tournament data for testing.
 * Creates tournament settings, teams, players, tournament entries,
 * fixtures, and optional fake results. Uses fake Discord IDs (9xx...)
 * so there's no collision with real users.
 *
 * Prerequisite: No existing TEST teams or tournaments with the same key.
 * Cleanup: `.cleartournamenttest confirm`
 *
 * Usage:  .seedtournament key=test-s1 teams=16 groups=4 playersPerTeam=3 assignGroups=false fixtures=false results=false
 * Slash:  /seedtournament key:<key> teams:<n> [groups] [players_per_team] ...
 *
 * Aliases: seedtour, devseed, testseed
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    Fixture,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    UserProfile
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { buildRoundRobinFixtures } = require('../../utils/fixtureBuilder');

module.exports = {
    name: 'seedtournament',
    description: 'Seed fake tournament data for testing.',
    usage: '.seedtournament key=test-s1 teams=16 groups=4 playersPerTeam=3 assignGroups=false fixtures=false results=false',
    aliases: ['seedtour', 'devseed', 'testseed'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('seedtournament')
        .setDescription('Seed fake tournament data for testing')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key, example: test-s1')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('teams')
                .setDescription('Number of fake teams')
                .setRequired(true)
                .setMinValue(2)
                .setMaxValue(64)
        )
        .addIntegerOption(opt =>
            opt.setName('groups')
                .setDescription('Number of groups')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(16)
        )
        .addIntegerOption(opt =>
            opt.setName('players_per_team')
                .setDescription('Fake players per team including captain')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)
        )
        .addBooleanOption(opt =>
            opt.setName('assign_groups')
                .setDescription('Assign group keys now?')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('fixtures')
                .setDescription('Generate fixtures too?')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('results')
                .setDescription('Randomly mark some fixtures as played?')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized to use this command.');
            }

            const parsed = parsePrefixArgs(args);

            if (!parsed.ok) {
                return message.reply(parsed.error);
            }

            return await runSeed({
                guild: message.guild,
                config: parsed.config,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[seedtournament] prefix error:', error);
            return message.reply('❌ Failed to seed tournament test data.');
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

            const config = {
                key: interaction.options.getString('key').toLowerCase(),
                teams: interaction.options.getInteger('teams'),
                groups: interaction.options.getInteger('groups') ?? 0,
                playersPerTeam: interaction.options.getInteger('players_per_team') ?? 3,
                assignGroups: interaction.options.getBoolean('assign_groups') ?? false,
                fixtures: interaction.options.getBoolean('fixtures') ?? false,
                results: interaction.options.getBoolean('results') ?? false
            };

            return await runSeed({
                guild: interaction.guild,
                config,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[seedtournament] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to seed tournament test data.');
            }

            return interaction.reply({
                content: '❌ Failed to seed tournament test data.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   PREFIX ARG PARSER
==================================================== */

/** Parse key=value pairs from prefix args into a config object. */
function parsePrefixArgs(args) {
    const config = {
        key: 'test-s1',
        teams: null,
        groups: 0,
        playersPerTeam: 3,
        assignGroups: false,
        fixtures: false,
        results: false
    };

    for (const arg of args) {
        const [rawKey, rawValue] = arg.split('=');
        if (!rawKey || typeof rawValue === 'undefined') continue;

        const key = rawKey.trim();
        const value = rawValue.trim();

        if (key === 'key') config.key = value.toLowerCase();
        if (key === 'teams') config.teams = parseInt(value, 10);
        if (key === 'groups') config.groups = parseInt(value, 10);
        if (key === 'playersPerTeam') config.playersPerTeam = parseInt(value, 10);
        if (key === 'assignGroups') config.assignGroups = value === 'true';
        if (key === 'fixtures') config.fixtures = value === 'true';
        if (key === 'results') config.results = value === 'true';
    }

    if (!config.teams || Number.isNaN(config.teams)) {
        return {
            ok: false,
            error:
                '❓ Usage:\n' +
                '`.seedtournament key=test-s1 teams=16 groups=4 playersPerTeam=3 assignGroups=false fixtures=false results=false`'
        };
    }

    if (!/^[a-z0-9_-]{2,32}$/i.test(config.key)) {
        return {
            ok: false,
            error: '❌ Invalid key. Use something like `test-s1`, `league-test`, or `cup-test`.'
        };
    }

    return { ok: true, config };
}

/* ====================================================
   CORE SEED LOGIC
==================================================== */

/**
 * Create a full test tournament: settings, teams, players,
 * tournament entries, optional fixtures and fake results.
 */
async function runSeed({ guild, config, reply }) {
    const { key, teams, groups, playersPerTeam, assignGroups, fixtures, results } = config;

    /* ── Validate config ── */
    if (groups > 0 && groups > teams) {
        return reply({ content: '❌ `groups` cannot be greater than `teams`.' });
    }

    const existingTournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey: key
    });

    if (existingTournament) {
        return reply({
            content:
                `⚠️ Tournament key \`${key}\` already exists.\n` +
                `Use \`.cleartournamenttest confirm\` first if this is test data.`
        });
    }

    const existingTestTeams = await Team.countDocuments({
        guildId: guild.id,
        name: /^TEST /i
    });

    if (existingTestTeams > 0) {
        return reply({
            content:
                `⚠️ Found **${existingTestTeams}** existing TEST team(s).\n` +
                `Run \`.cleartournamenttest confirm\` first.`
        });
    }

    /* ── Create tournament settings ── */
    const tournament = await TournamentSettings.create({
        guildId: guild.id,
        tournamentKey: key,
        name: `TEST Tournament ${key.toUpperCase()}`,
        emoji: '🧪',

        formatType: groups > 0 ? 'groups_knockout' : 'league',
        schedulingMode: 'hybrid',

        teamCount: teams,
        groupCount: groups,
        teamsPerGroup: groups > 0 ? Math.ceil(teams / groups) : 0,

        homeAway: false,
        hasKnockout: groups > 0,
        knockoutRounds: groups > 0 ? ['semifinal', 'final'] : [],
        twoLeggedRounds: [],
        finalNeutralVenue: true,

        currentPhase: 'registration',
        registrationOpen: true,

        manualGroupDraw: groups > 0 && !assignGroups,
        manualKnockoutDraw: false,
        autoGenerateGroupFixtures: false,
        autoSeedKnockouts: false,

        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,

        captainRoleId: '',
        tournamentPlayerRoleId: ''
    });

    /* ── Create teams and players ── */
    const groupKeys = Array.from(
        { length: groups },
        (_, index) => String.fromCharCode(65 + index)
    );

    const testNames = buildTestTeamNames(teams);

    const createdTeams = [];
    const createdPlayers = [];
    const createdTournamentTeams = [];
    const createdTournamentPlayers = [];

    for (let i = 0; i < teams; i++) {
        const teamName = `TEST ${testNames[i]}`;
        const captainId = generateFakeDiscordId(i, 0);
        const groupKey = assignGroups && groups > 0
            ? groupKeys[i % groups]
            : null;

        const team = await Team.create({
            guildId: guild.id,
            name: teamName,
            captainID: captainId,
            logoURL: '',
            color: randomColor(),
            stadium: `${testNames[i]} Arena`
        });

        createdTeams.push(team);

        const tournamentTeam = await TournamentTeam.create({
            guildId: guild.id,
            tournamentId: tournament._id,
            teamId: team._id,
            teamNameSnapshot: team.name,
            groupKey,
            isActive: true,
            stats: emptyTeamStats()
        });

        createdTournamentTeams.push(tournamentTeam);

        /* ── Create players for this team ── */
        for (let p = 0; p < playersPerTeam; p++) {
            const isCaptain = p === 0;
            const fakeUserId = isCaptain
                ? captainId
                : generateFakeDiscordId(i, p);

            const player = await Player.create({
                guildId: guild.id,
                name: isCaptain
                    ? `${testNames[i]} Captain`
                    : `${testNames[i]} Player ${p + 1}`,
                discordID: fakeUserId,
                teamId: team._id,
                teamNameSnapshot: team.name,
                isCaptain
            });

            createdPlayers.push(player);

            const tournamentPlayer = await TournamentPlayer.create({
                guildId: guild.id,
                tournamentId: tournament._id,
                playerId: player._id,
                teamId: team._id,
                tournamentTeamId: tournamentTeam._id,

                name: player.name,
                playerNameSnapshot: player.name,
                teamNameSnapshot: team.name,
                discordID: fakeUserId,

                isCaptain,
                isActive: true,
                stats: emptyPlayerStats()
            });

            createdTournamentPlayers.push(tournamentPlayer);

            await UserProfile.updateOne(
                { guildId: guild.id, discordID: fakeUserId },
                {
                    $setOnInsert: {
                        guildId: guild.id,
                        discordID: fakeUserId,
                        displayName: player.name,
                        allTimeStats: emptyPlayerStats(),
                        trophies: [],
                        awards: []
                    }
                },
                { upsert: true }
            );
        }
    }

    /* ── Generate fixtures if requested ── */
    let createdFixtures = [];

    if (fixtures) {
        if (groups > 0) {
            if (!assignGroups) {
                return reply({
                    content:
                        '⚠️ Test teams and players were created, but fixtures were not generated.\n' +
                        '`assignGroups=false`, so use `/startdraw` and `/finishdraw` to test manual draw.'
                });
            }

            let nextMatchNumber = 1;

            for (const groupKey of groupKeys) {
                const groupTeams = createdTournamentTeams.filter(entry => entry.groupKey === groupKey);

                const groupFixtures = buildRoundRobinFixtures({
                    guildId: guild.id,
                    tournament,
                    teams: groupTeams.map(entry => ({
                        tournamentTeamId: entry._id,
                        teamId: entry.teamId,
                        name: entry.teamNameSnapshot
                    })),
                    phase: 'group',
                    roundPrefix: `Group ${groupKey} Matchday`,
                    groupKey,
                    homeAway: false,
                    startMatchNumber: nextMatchNumber
                });

                nextMatchNumber += groupFixtures.length;
                createdFixtures.push(...groupFixtures);
            }
        } else {
            createdFixtures = buildRoundRobinFixtures({
                guildId: guild.id,
                tournament,
                teams: createdTournamentTeams.map(entry => ({
                    tournamentTeamId: entry._id,
                    teamId: entry.teamId,
                    name: entry.teamNameSnapshot
                })),
                phase: 'league',
                roundPrefix: 'Matchday',
                groupKey: null,
                homeAway: false,
                startMatchNumber: 1
            });
        }

        if (createdFixtures.length) {
            await Fixture.insertMany(createdFixtures);
        }

        /* ── Apply fake results if requested ── */
        if (results && createdFixtures.length) {
            await applyFakeResults({
                guildId: guild.id,
                tournament,
                fixtures: createdFixtures
            });
        }

        tournament.currentPhase = groups > 0 ? 'groups' : 'league';
        await tournament.save();
    }

    /* ── Summary embed ── */
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🧪 TEST TOURNAMENT SEEDED')
        .setDescription(
            `Created new multi-tournament test data for **${guild.name}**.\n\n` +
            `🧪 Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\``
        )
        .addFields(
            {
                name: 'Created',
                value:
                    `Teams: **${createdTeams.length}**\n` +
                    `Players: **${createdPlayers.length}**\n` +
                    `TournamentTeams: **${createdTournamentTeams.length}**\n` +
                    `TournamentPlayers: **${createdTournamentPlayers.length}**`,
                inline: true
            },
            {
                name: 'Format',
                value:
                    `Groups: **${groups || 0}**\n` +
                    `Groups Assigned: **${assignGroups ? 'Yes' : 'No'}**\n` +
                    `Fixtures: **${createdFixtures.length}**`,
                inline: true
            },
            {
                name: 'Testing Tip',
                value:
                    groups > 0 && !assignGroups
                        ? 'Use `/startdraw`, public draw buttons, then `/finishdraw`.'
                        : 'Use standings, topstats, nextmatch, master-schedule, report, addstats, and matchresults.',
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   FAKE RESULTS ENGINE
==================================================== */

/**
 * Randomly mark ~half of the generated fixtures as played.
 * Updates fixture results, team standings, player stats, and user profiles.
 */
async function applyFakeResults({ guildId, tournament, fixtures }) {
    const toPlay = fixtures.slice(0, Math.floor(fixtures.length / 2));

    for (const fixtureData of toPlay) {
        const fixture = await Fixture.findOne({
            guildId,
            tournamentId: tournament._id,
            matchNumber: fixtureData.matchNumber
        });

        if (!fixture) continue;

        const homeGoals = randomInt(0, 4);
        const awayGoals = randomInt(0, 4);

        const winner =
            homeGoals > awayGoals
                ? fixture.homeTeam
                : awayGoals > homeGoals
                    ? fixture.awayTeam
                    : '';

        fixture.status = 'Played';
        fixture.result = {
            home: homeGoals,
            away: awayGoals,
            extraTimeHome: null,
            extraTimeAway: null,
            penaltiesHome: null,
            penaltiesAway: null,
            winner
        };
        fixture.reportedAt = new Date();

        await fixture.save();

        /* ── Update team standings ── */
        if (fixture.phase === 'group' || fixture.phase === 'league') {
            await applyTeamResult({ guildId, tournament, fixture, homeGoals, awayGoals });
            await applyRandomPlayerStats({ guildId, tournament, fixture, homeGoals, awayGoals });
        }
    }
}

/* ====================================================
   TEAM RESULT HELPERS
==================================================== */

/** Apply a result to both team TournamentTeam standings entries. */
async function applyTeamResult({ guildId, tournament, fixture, homeGoals, awayGoals }) {
    const homeEntry = await TournamentTeam.findOne({
        guildId,
        tournamentId: tournament._id,
        _id: fixture.homeTournamentTeamId
    });

    const awayEntry = await TournamentTeam.findOne({
        guildId,
        tournamentId: tournament._id,
        _id: fixture.awayTournamentTeamId
    });

    if (!homeEntry || !awayEntry) return;

    addTeamResult(homeEntry.stats, homeGoals, awayGoals, tournament);
    addTeamResult(awayEntry.stats, awayGoals, homeGoals, tournament);

    await homeEntry.save();
    await awayEntry.save();
}

/** Increment W/D/L/GF/GA/Pts on a stats object. */
function addTeamResult(stats, gf, ga, tournament) {
    stats.played = (stats.played || 0) + 1;
    stats.gf = (stats.gf || 0) + gf;
    stats.ga = (stats.ga || 0) + ga;

    if (gf > ga) {
        stats.wins = (stats.wins || 0) + 1;
        stats.points = (stats.points || 0) + (tournament.pointsWin ?? 3);
    } else if (gf < ga) {
        stats.losses = (stats.losses || 0) + 1;
        stats.points = (stats.points || 0) + (tournament.pointsLoss ?? 0);
    } else {
        stats.draws = (stats.draws || 0) + 1;
        stats.points = (stats.points || 0) + (tournament.pointsDraw ?? 1);
    }
}

/* ====================================================
   PLAYER STAT HELPERS
==================================================== */

/** Apply random player stats for a single fixture result. */
async function applyRandomPlayerStats({ guildId, tournament, fixture, homeGoals, awayGoals }) {
    const homePlayers = await TournamentPlayer.find({
        guildId,
        tournamentId: tournament._id,
        teamId: fixture.homeTeamId,
        isActive: true
    });

    const awayPlayers = await TournamentPlayer.find({
        guildId,
        tournamentId: tournament._id,
        teamId: fixture.awayTeamId,
        isActive: true
    });

    const allPlayers = [...homePlayers, ...awayPlayers];

    for (const player of allPlayers) {
        player.stats.played = (player.stats.played || 0) + 1;
    }

    /* ── Distribute goals and assists ── */
    for (let i = 0; i < homeGoals; i++) {
        const scorer = randomItem(homePlayers);
        const assister = randomItem(homePlayers);

        if (scorer) scorer.stats.goals = (scorer.stats.goals || 0) + 1;
        if (assister) assister.stats.assists = (assister.stats.assists || 0) + 1;
    }

    for (let i = 0; i < awayGoals; i++) {
        const scorer = randomItem(awayPlayers);
        const assister = randomItem(awayPlayers);

        if (scorer) scorer.stats.goals = (scorer.stats.goals || 0) + 1;
        if (assister) assister.stats.assists = (assister.stats.assists || 0) + 1;
    }

    /* ── Save each player + update UserProfile ── */
    for (const player of allPlayers) {
        player.stats.tackles = (player.stats.tackles || 0) + randomInt(0, 4);
        player.stats.interceptions = (player.stats.interceptions || 0) + randomInt(0, 3);
        player.stats.saves = (player.stats.saves || 0) + randomInt(0, 5);

        await player.save();

        await UserProfile.updateOne(
            { guildId, discordID: player.discordID },
            {
                $inc: {
                    'allTimeStats.played': 1,
                    'allTimeStats.goals': player.stats.goals || 0,
                    'allTimeStats.assists': player.stats.assists || 0,
                    'allTimeStats.tackles': player.stats.tackles || 0,
                    'allTimeStats.interceptions': player.stats.interceptions || 0,
                    'allTimeStats.saves': player.stats.saves || 0
                },
                $setOnInsert: {
                    guildId,
                    discordID: player.discordID,
                    displayName: player.name,
                    trophies: [],
                    awards: []
                }
            },
            { upsert: true }
        );
    }
}

/* ====================================================
   SEED HELPERS
==================================================== */

/** Build an empty team stats object. */
function emptyTeamStats() {
    return { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };
}

/** Build an empty player stats object. */
function emptyPlayerStats() {
    return { played: 0, goals: 0, assists: 0, saves: 0, tackles: 0, interceptions: 0, yc: 0, rc: 0, mvps: 0 };
}

/** Generate realistic team names for seeding. */
function buildTestTeamNames(count) {
    const base = [
        'Falcons', 'Titans', 'Storm', 'Inferno', 'Velocity', 'Shadow', 'Phoenix', 'Rangers',
        'Warriors', 'Dragons', 'Royals', 'Thunder', 'Gladiators', 'Knights', 'Blue Lock', 'Strikers',
        'Blaze', 'Wolves', 'Stars', 'Dynasty', 'Legends', 'Force', 'Empire', 'Hunters',
        'Raiders', 'Cyclones', 'Vortex', 'Comets', 'Giants', 'United', 'Athletic', 'City',
        'Matrix', 'Simgas', 'Predators', 'Lunpul', 'Protectors', 'Comets FC', 'Mavericks', 'Spartans'
    ];

    const names = [];
    for (let i = 0; i < count; i++) {
        names.push(base[i] || `Club ${i + 1}`);
    }
    return names;
}

/** Generate a fake Discord ID in the 900 quadrillion range. */
function generateFakeDiscordId(teamIndex, playerIndex) {
    const base = BigInt('900000000000000000');
    const value = base + BigInt(teamIndex * 100 + playerIndex);
    return value.toString();
}

/** Pick a random color from a preset palette. */
function randomColor() {
    const colors = [
        '#FF5733', '#3498DB', '#2ECC71', '#9B59B6',
        '#F1C40F', '#E67E22', '#1ABC9C', '#E91E63'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/** Random integer between min and max inclusive. */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array. */
function randomItem(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}
