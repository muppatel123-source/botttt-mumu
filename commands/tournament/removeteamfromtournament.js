const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    Team,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    Fixture
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'removeteamfromtournament',
    description: 'Remove a team from a tournament and give opponents 3-0 walkover wins.',
    usage: '.removeteamfromtournament <key> <team name>',
    aliases: ['removefromtour', 'rtt', 'removetourteam'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('removeteamfromtournament')
        .setDescription('Remove a team from a specific tournament')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            if (args.length < 2) {
                return message.reply('❓ Usage: `.removeteamfromtournament <key> <team name>`');
            }

            return await runRemove({
                guild: message.guild,
                tournamentKey: args[0].toLowerCase(),
                teamName: args.slice(1).join(' '),
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('removeteamfromtournament prefix error:', error);
            return message.reply('❌ Failed to remove team from tournament.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runRemove({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                teamName: interaction.options.getString('team'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('removeteamfromtournament slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to remove team from tournament.');
            }

            return interaction.reply({
                content: '❌ Failed to remove team from tournament.',
                ephemeral: true
            });
        }
    }
};

async function runRemove({
    guild,
    tournamentKey,
    teamName,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({ content: `❌ Tournament \`${tournamentKey}\` not found.` });
    }

    const team = await Team.findOne({
        guildId: guild.id,
        name: {
            $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
        }
    });

    if (!team) {
        return reply({ content: `❌ Team **${teamName}** not found.` });
    }

    const entry = await TournamentTeam.findOne({
        guildId: guild.id,
        tournamentId: tournament._id,
        teamId: team._id
    });

    if (!entry) {
        return reply({
            content: `❌ **${team.name}** is not in **${tournament.name}**.`
        });
    }

    entry.isActive = false;
    await entry.save();

    const playerUpdate = await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            tournamentId: tournament._id,
            teamId: team._id
        },
        {
            $set: {
                isActive: false
            }
        }
    );

    const walkoverResult = await applyWalkovers({
        guildId: guild.id,
        tournament,
        withdrawnTeam: team
    });

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🚫 TEAM WITHDRAWN FROM TOURNAMENT')
        .setDescription(
            `**${team.name}** has been removed from **${tournament.name}**.\n\n` +
            `${tournament.emoji || '🏆'} Key: \`${tournament.tournamentKey}\`\n` +
            `Players disabled: **${playerUpdate.modifiedCount || 0}**`
        )
        .addFields(
            {
                name: 'Walkovers Applied',
                value:
                    `Fixtures reported 3-0: **${walkoverResult.updatedFixtures}**\n` +
                    `Opponent standing wins: **${walkoverResult.opponentWins}**\n` +
                    `Withdrawn team losses: **${walkoverResult.withdrawnLosses}**`,
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function applyWalkovers({
    guildId,
    tournament,
    withdrawnTeam
}) {
    const fixtures = await Fixture.find({
        guildId,
        tournamentId: tournament._id,
        status: { $ne: 'Played' },
        $or: [
            { homeTeamId: withdrawnTeam._id },
            { awayTeamId: withdrawnTeam._id },
            { homeTeam: withdrawnTeam.name },
            { awayTeam: withdrawnTeam.name }
        ]
    });

    let updatedFixtures = 0;
    let opponentWins = 0;
    let withdrawnLosses = 0;

    for (const fixture of fixtures) {
        const withdrawnIsHome =
            String(fixture.homeTeamId || '') === String(withdrawnTeam._id) ||
            fixture.homeTeam === withdrawnTeam.name;

        const withdrawnIsAway =
            String(fixture.awayTeamId || '') === String(withdrawnTeam._id) ||
            fixture.awayTeam === withdrawnTeam.name;

        if (!withdrawnIsHome && !withdrawnIsAway) continue;

        const opponentTeamId = withdrawnIsHome
            ? fixture.awayTeamId
            : fixture.homeTeamId;

        const withdrawnTeamId = withdrawnIsHome
            ? fixture.homeTeamId
            : fixture.awayTeamId;

        const opponentEntry = await TournamentTeam.findOne({
            guildId,
            tournamentId: tournament._id,
            teamId: opponentTeamId
        });

        const withdrawnEntry = await TournamentTeam.findOne({
            guildId,
            tournamentId: tournament._id,
            teamId: withdrawnTeamId
        });

        fixture.status = 'Played';

        fixture.result = {
            ...(fixture.result || {}),
            home: withdrawnIsHome ? 0 : 3,
            away: withdrawnIsAway ? 0 : 3,
            extraTimeHome: null,
            extraTimeAway: null,
            penaltiesHome: null,
            penaltiesAway: null,
            winner: withdrawnIsHome ? fixture.awayTeam : fixture.homeTeam
        };

        fixture.notes = `Walkover: ${withdrawnTeam.name} withdrew from ${tournament.name}.`;
        fixture.reportedAt = new Date();

        await fixture.save();
        updatedFixtures++;

        if (opponentEntry) {
            addWin(opponentEntry.stats, 3, 0, tournament);
            await opponentEntry.save();
            opponentWins++;
        }

        if (withdrawnEntry) {
            addLoss(withdrawnEntry.stats, 0, 3, tournament);
            await withdrawnEntry.save();
            withdrawnLosses++;
        }
    }

    return {
        updatedFixtures,
        opponentWins,
        withdrawnLosses
    };
}

function addWin(stats, gf, ga, tournament) {
    stats.played = (stats.played || 0) + 1;
    stats.wins = (stats.wins || 0) + 1;
    stats.gf = (stats.gf || 0) + gf;
    stats.ga = (stats.ga || 0) + ga;
    stats.points = (stats.points || 0) + (tournament.pointsWin ?? 3);
}

function addLoss(stats, gf, ga, tournament) {
    stats.played = (stats.played || 0) + 1;
    stats.losses = (stats.losses || 0) + 1;
    stats.gf = (stats.gf || 0) + gf;
    stats.ga = (stats.ga || 0) + ga;
    stats.points = (stats.points || 0) + (tournament.pointsLoss ?? 0);
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}