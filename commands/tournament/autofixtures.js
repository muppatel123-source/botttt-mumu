const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Fixture,
    TournamentSettings,
    TournamentTeam
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'autofixtures',
    description: 'Auto-generate fixtures for a specific tournament.',
    usage: '.autofixtures <tournamentKey> [--force]',
    aliases: ['generatefixtures', 'fixturesauto'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('autofixtures')
        .setDescription('Auto-generate tournament fixtures')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key, example: league-s1')
                .setRequired(true)
        )
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('Delete existing fixtures for this tournament and regenerate')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized to use this command.');
            }

            if (!args.length) {
                return message.reply('❓ Usage: `.autofixtures <tournamentKey> [--force]`');
            }

            const tournamentKey = args[0].toLowerCase();
            const force = args.includes('--force');

            return await runAutoFixtures({
                guild: message.guild,
                tournamentKey,
                force,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('autofixtures.js prefix error:', error);
            return message.reply('❌ Failed to generate fixtures.');
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

            return await runAutoFixtures({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                force: interaction.options.getBoolean('force') ?? false,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('autofixtures.js slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to generate fixtures.');
            }

            return interaction.reply({
                content: '❌ Failed to generate fixtures.',
                ephemeral: true
            });
        }
    }
};

async function runAutoFixtures({
    guild,
    tournamentKey,
    force,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const existingFixtures = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id
    });

    if (existingFixtures > 0 && !force) {
        return reply({
            content:
                `⚠️ Fixtures already exist for **${tournament.name}**: **${existingFixtures}**\n\n` +
                `Use \`.autofixtures ${tournamentKey} --force\` or slash \`force:true\` to regenerate.`
        });
    }

    if (existingFixtures > 0 && force) {
        await Fixture.deleteMany({
            guildId: guild.id,
            tournamentId: tournament._id
        });
    }

    const tournamentTeams = await TournamentTeam.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        isActive: true
    })
        .populate('teamId')
        .sort({ createdAt: 1 });

    if (tournamentTeams.length < 2) {
        return reply({
            content: '❌ At least 2 active teams are required in this tournament.'
        });
    }

    const homeAway = tournament.homeAway === true;
    const groupCount = tournament.groupCount || 0;

    const fixturesToCreate = [];
    let nextMatchNumber = 1;

    // Auto-create groups if groups are enabled but no group assignments exist
if (groupCount > 0) {
    const teamsWithoutGroups = tournamentTeams.filter(
    team => !String(team.groupKey || '').trim()
);

    if (teamsWithoutGroups.length > 0) {
        const groupKeys = Array.from(
            { length: groupCount },
            (_, i) => String.fromCharCode(65 + i)
        );

        // Shuffle teams
        const shuffledTeams = [...tournamentTeams]
            .sort(() => Math.random() - 0.5);

        // Snake draft distribution
        let direction = 1;
        let groupIndex = 0;

        for (const team of shuffledTeams) {
            const groupKey = groupKeys[groupIndex];

            await TournamentTeam.updateOne(
                { _id: team._id },
                {
                    $set: { groupKey }
                }
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

        // Reload teams with fresh group assignments
        tournamentTeams.splice(
            0,
            tournamentTeams.length,
            ...(await TournamentTeam.find({
                guildId: guild.id,
                tournamentId: tournament._id,
                isActive: true
            })
                .populate('teamId')
                .sort({ createdAt: 1 }))
        );
    }
}
    
    if (groupCount > 0) {
        const groupKeys = Array.from(
            { length: groupCount },
            (_, i) => String.fromCharCode(65 + i)
        );

        for (const groupKey of groupKeys) {
            const groupTeams = tournamentTeams.filter(team => team.groupKey === groupKey);

            if (groupTeams.length < 2) continue;

            const groupFixtures = generateRoundRobinFixtures({
                guildId: guild.id,
                tournament,
                teams: groupTeams,
                phase: 'group',
                roundPrefix: `Group ${groupKey} Matchday`,
                groupKey,
                homeAway,
                startMatchNumber: nextMatchNumber
            });

            nextMatchNumber += groupFixtures.length;
            fixturesToCreate.push(...groupFixtures);
        }
    } else {
        const leagueFixtures = generateRoundRobinFixtures({
            guildId: guild.id,
            tournament,
            teams: tournamentTeams,
            phase: 'league',
            roundPrefix: 'Matchday',
            groupKey: null,
            homeAway,
            startMatchNumber: nextMatchNumber
        });

        fixturesToCreate.push(...leagueFixtures);
    }

    if (!fixturesToCreate.length) {
        return reply({
            content:
                '❌ No fixtures were generated.\n\n' +
                'Possible reasons:\n' +
                '• Groups are enabled but tournament teams do not have group keys\n' +
                '• Each group has less than 2 active teams\n' +
                '• Tournament setup is incomplete'
        });
    }

    await Fixture.insertMany(fixturesToCreate);

    await TournamentSettings.updateOne(
        {
            guildId: guild.id,
            tournamentKey
        },
        {
            $set: {
                currentPhase: groupCount > 0 ? 'groups' : 'league',
                teamCount: tournamentTeams.length
            }
        }
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📅 FIXTURES GENERATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Created **${fixturesToCreate.length}** fixture(s).\n` +
            `Teams used: **${tournamentTeams.length}**\n` +
            `Format: **${groupCount > 0 ? 'Group Stage' : 'League'}**\n` +
            `Home & Away: **${homeAway ? 'Yes' : 'No'}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

function generateRoundRobinFixtures({
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
        const firstLegFixtures = [...fixtures];

        for (const fixture of firstLegFixtures) {
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

function buildFixture({
    guildId,
    tournament,
    phase,
    groupKey,
    roundLabel,
    matchNumber,
    home,
    away
}) {
    return {
        guildId,
        tournamentId: tournament._id,
        tournamentKey: tournament.tournamentKey,
        phase,
        roundLabel,
        groupKey,
        leg: 1,
        matchNumber,

        homeTeamId: home.teamId || null,
        awayTeamId: away.teamId || null,
        homeTournamentTeamId: home.tournamentTeamId || null,
        awayTournamentTeamId: away.tournamentTeamId || null,

        homeTeam: home.name,
        awayTeam: away.name,

        venueType: 'home',
        venueName: 'Home Ground',
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
        aggregateTieKey: null,
        notes: '',
        bracket: {
            advancesToMatchNumber: null,
            slot: ''
        }
    };
}

function extractRoundNumber(label) {
    const match = String(label).match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
}
