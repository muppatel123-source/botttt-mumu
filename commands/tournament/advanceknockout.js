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
    name: 'advanceknockout',
    description: 'Advance winners into the next knockout round.',
    usage: '.advanceknockout [tournamentKey] <currentPhase> <nextPhase>',
    aliases: ['advanceko', 'nextknockout'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('advanceknockout')
        .setDescription('Advance knockout winners')
        .addStringOption(opt =>
            opt.setName('current_phase')
                .setDescription('Current knockout phase')
                .setRequired(true)
                .addChoices(
                    { name: 'Qualifier', value: 'qualifier' },
                    { name: 'Eliminator', value: 'eliminator' },
                    { name: 'Quarter Final', value: 'quarterfinal' },
                    { name: 'Semi Final', value: 'semifinal' }
                )
        )
        .addStringOption(opt =>
            opt.setName('next_phase')
                .setDescription('Next knockout phase')
                .setRequired(true)
                .addChoices(
                    { name: 'Eliminator', value: 'eliminator' },
                    { name: 'Quarter Final', value: 'quarterfinal' },
                    { name: 'Semi Final', value: 'semifinal' },
                    { name: 'Final', value: 'final' }
                )
        )
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (args.length < 2) {
                return message.reply(
                    '❌ Usage: `.advanceknockout [tournamentKey] <currentPhase> <nextPhase>`'
                );
            }

            let key = null;
            let currentPhase;
            let nextPhase;

            if (args.length === 2) {
                [currentPhase, nextPhase] = args;
            } else {
                [key, currentPhase, nextPhase] = args;
                key = key.toLowerCase();
            }

            return await runAdvance({
                guild: message.guild,
                key,
                currentPhase: currentPhase.toLowerCase(),
                nextPhase: nextPhase.toLowerCase(),
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('advanceknockout prefix error:', error);
            return message.reply('❌ Failed to advance knockout stage.');
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

            return await runAdvance({
                guild: interaction.guild,
                key: interaction.options.getString('key')?.toLowerCase() || null,
                currentPhase: interaction.options.getString('current_phase'),
                nextPhase: interaction.options.getString('next_phase'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('advanceknockout slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to advance knockout.');
            }

            return interaction.reply({
                content: '❌ Failed to advance knockout.',
                ephemeral: true
            });
        }
    }
};

async function runAdvance({
    guild,
    key,
    currentPhase,
    nextPhase,
    reply
}) {
    const tournament = key
        ? await getTournamentByKey(guild.id, key, { includeCompleted: true })
        : await getDefaultTournament(guild.id, { includeCompleted: true });

    if (!tournament) {
        return reply({
            content: '❌ Tournament not found.'
        });
    }

    const fixtures = await Fixture.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: currentPhase
    }).sort({
        matchNumber: 1,
        leg: 1
    });

    if (!fixtures.length) {
        return reply({
            content: `❌ No fixtures found for phase \`${currentPhase}\`.`
        });
    }

    const unplayed = fixtures.filter(fixture => fixture.status !== 'Played');

    if (unplayed.length) {
        return reply({
            content:
                `❌ ${unplayed.length} fixture(s) are still not completed in ` +
                `\`${currentPhase}\`.`
        });
    }

    const existingNextRound = await Fixture.countDocuments({
        guildId: guild.id,
        tournamentId: tournament._id,
        phase: nextPhase
    });

    if (existingNextRound > 0) {
        return reply({
            content:
                `❌ \`${nextPhase}\` fixtures already exist for this tournament.\n` +
                `Delete/reset them first if you want to regenerate.`
        });
    }

    const winners = [];

    for (const fixture of fixtures) {
        const winner = await determineWinner(fixture);

        if (!winner) {
            return reply({
                content:
                    `❌ Could not determine winner for fixture #${fixture.matchNumber}.\n` +
                    `If it was a draw, penalties must be saved first.`
            });
        }

        winners.push(winner);
    }

    const uniqueWinners = dedupeWinners(winners);

    if (uniqueWinners.length < 2) {
        return reply({
            content: '❌ Not enough winners to create the next round.'
        });
    }

    if (uniqueWinners.length % 2 !== 0) {
        return reply({
            content:
                `❌ Winner count is odd (**${uniqueWinners.length}**). ` +
                'Cannot generate next round properly.'
        });
    }

    const createdFixtures = [];

    for (let i = 0; i < uniqueWinners.length; i += 2) {
        const home = uniqueWinners[i];
        const away = uniqueWinners[i + 1];

        const matchNumber = await getNextMatchNumber(
            guild.id,
            tournament._id
        );

        const fixture = await Fixture.create({
            guildId: guild.id,
            tournamentId: tournament._id,
            tournamentKey: tournament.tournamentKey,

            phase: nextPhase,
            roundLabel: getRoundLabel(nextPhase),
            groupKey: null,
            leg: 1,
            matchNumber,

            homeTeam: home.team.name,
            awayTeam: away.team.name,

            homeTeamId: home.team._id,
            awayTeamId: away.team._id,

            homeTournamentTeamId: home.entry._id,
            awayTournamentTeamId: away.entry._id,

            venueType: nextPhase === 'final' && tournament.finalNeutralVenue
                ? 'neutral'
                : 'home',
            venueName: nextPhase === 'final' && tournament.finalNeutralVenue
                ? 'Neutral Venue'
                : `${home.team.name} Stadium`,

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
        });

        createdFixtures.push(fixture);
    }

    tournament.currentPhase = nextPhase;
    await tournament.save();

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏆 KNOCKOUT ADVANCED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Advanced From: **${prettyPhase(currentPhase)}**\n` +
            `Advanced To: **${prettyPhase(nextPhase)}**`
        )
        .addFields(
            {
                name: 'Winners',
                value: uniqueWinners
                    .map(winner => `• ${winner.team.name}`)
                    .join('\n'),
                inline: false
            },
            {
                name: 'New Fixtures Created',
                value: createdFixtures.length
                    ? createdFixtures
                        .map(fixture =>
                            `#${fixture.matchNumber} • ${fixture.homeTeam} vs ${fixture.awayTeam}`
                        )
                        .join('\n')
                    : 'None',
                inline: false
            }
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

async function determineWinner(fixture) {
    if (fixture.result?.winner) {
        return findWinnerEntryByName(fixture, fixture.result.winner);
    }

    const homeGoals = Number(fixture.result?.home ?? 0);
    const awayGoals = Number(fixture.result?.away ?? 0);

    let winnerTournamentTeamId = null;
    let winnerTeamId = null;

    if (homeGoals > awayGoals) {
        winnerTournamentTeamId = fixture.homeTournamentTeamId;
        winnerTeamId = fixture.homeTeamId;
    } else if (awayGoals > homeGoals) {
        winnerTournamentTeamId = fixture.awayTournamentTeamId;
        winnerTeamId = fixture.awayTeamId;
    } else {
        const homePens = fixture.result?.penaltiesHome;
        const awayPens = fixture.result?.penaltiesAway;

        if (
            homePens === null ||
            awayPens === null ||
            typeof homePens === 'undefined' ||
            typeof awayPens === 'undefined'
        ) {
            return null;
        }

        if (homePens > awayPens) {
            winnerTournamentTeamId = fixture.homeTournamentTeamId;
            winnerTeamId = fixture.homeTeamId;
        } else if (awayPens > homePens) {
            winnerTournamentTeamId = fixture.awayTournamentTeamId;
            winnerTeamId = fixture.awayTeamId;
        } else {
            return null;
        }
    }

    return findWinnerEntry({
        fixture,
        winnerTournamentTeamId,
        winnerTeamId
    });
}

async function findWinnerEntry({
    fixture,
    winnerTournamentTeamId,
    winnerTeamId
}) {
    let entry = null;

    if (winnerTournamentTeamId) {
        entry = await TournamentTeam.findOne({
            _id: winnerTournamentTeamId,
            guildId: fixture.guildId,
            tournamentId: fixture.tournamentId
        }).populate('teamId');
    }

    if (!entry && winnerTeamId) {
        entry = await TournamentTeam.findOne({
            guildId: fixture.guildId,
            tournamentId: fixture.tournamentId,
            teamId: winnerTeamId
        }).populate('teamId');
    }

    if (!entry?.teamId) return null;

    return {
        entry,
        team: entry.teamId
    };
}

async function findWinnerEntryByName(fixture, winnerName) {
    const cleanWinner = String(winnerName || '').trim().toLowerCase();

    if (!cleanWinner) return null;

    const winnerIsHome =
        String(fixture.homeTeam || '').trim().toLowerCase() === cleanWinner;

    const winnerIsAway =
        String(fixture.awayTeam || '').trim().toLowerCase() === cleanWinner;

    if (!winnerIsHome && !winnerIsAway) return null;

    return findWinnerEntry({
        fixture,
        winnerTournamentTeamId: winnerIsHome
            ? fixture.homeTournamentTeamId
            : fixture.awayTournamentTeamId,
        winnerTeamId: winnerIsHome
            ? fixture.homeTeamId
            : fixture.awayTeamId
    });
}

function dedupeWinners(winners) {
    const seen = new Set();
    const unique = [];

    for (const winner of winners) {
        const key = String(winner.entry._id);

        if (seen.has(key)) continue;

        seen.add(key);
        unique.push(winner);
    }

    return unique;
}

async function getNextMatchNumber(guildId, tournamentId) {
    const latest = await Fixture.findOne({
        guildId,
        tournamentId
    })
        .sort({ matchNumber: -1 })
        .select('matchNumber');

    return latest ? Number(latest.matchNumber || 0) + 1 : 1;
}

function getRoundLabel(phase) {
    const map = {
        qualifier: 'Qualifier',
        eliminator: 'Eliminator',
        quarterfinal: 'Quarter Final',
        semifinal: 'Semi Final',
        final: 'Final'
    };

    return map[phase] || phase;
}

function prettyPhase(phase) {
    const map = {
        qualifier: 'Qualifier',
        eliminator: 'Eliminator',
        quarterfinal: 'Quarter Final',
        semifinal: 'Semi Final',
        final: 'Final'
    };

    return map[phase] || phase;
}