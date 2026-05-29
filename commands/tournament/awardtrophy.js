const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentTeam,
    TournamentPlayer,
    UserProfile
} = require('../../models/Tournament');

const {
    getTournamentByKey
} = require('../../utils/getTournament');

const { isOrganizer } = require('../../utils/isOrganizer');

const TROPHY_TYPES = {
    champion: {
        label: 'Winner',
        defaultEmoji: '🏆'
    },
    runner_up: {
        label: 'Runner Up',
        defaultEmoji: '🥈'
    }
};

module.exports = {
    name: 'awardtrophy',
    description: 'Award a tournament trophy to a team and its players.',
    usage: '.awardtrophy <tournamentKey> <team name> <champion|runner_up>',
    aliases: ['give-trophy', 'givetrophy', 'trophyaward'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('awardtrophy')
        .setDescription('Award a trophy to a tournament team')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Trophy type')
                .setRequired(true)
                .addChoices(
                    { name: 'Winner', value: 'champion' },
                    { name: 'Runner Up', value: 'runner_up' }
                )
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (args.length < 3) {
                return message.reply(
                    '❓ Usage: `.awardtrophy <tournamentKey> <team name> <champion|runner_up>`\n' +
                    'Example: `.awardtrophy league-s1 Simgas champion`'
                );
            }

            const tournamentKey = args[0].toLowerCase();
            const type = args[args.length - 1].toLowerCase();
            const teamName = args.slice(1, -1).join(' ').trim();

            return await runAwardTrophy({
                guild: message.guild,
                tournamentKey,
                teamName,
                type,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('awardtrophy prefix error:', error);
            return message.reply('❌ Failed to award trophy.');
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

            return await runAwardTrophy({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                teamName: interaction.options.getString('team'),
                type: interaction.options.getString('type'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('awardtrophy slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to award trophy.');
            }

            return interaction.reply({
                content: '❌ Failed to award trophy.',
                ephemeral: true
            });
        }
    }
};

async function runAwardTrophy({
    guild,
    tournamentKey,
    teamName,
    type,
    reply
}) {
    const trophyMeta = TROPHY_TYPES[type];

    if (!trophyMeta) {
        return reply({
            content: '❌ Invalid trophy type. Use `champion` or `runner_up`.'
        });
    }

    const tournament = await getTournamentByKey(
        guild.id,
        tournamentKey,
        { includeCompleted: true }
    );

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const team = await Team.findOne({
        guildId: guild.id,
        name: {
            $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
        }
    });

    if (!team) {
        return reply({
            content: `❌ Team **${teamName}** not found.`
        });
    }

    const tournamentTeam = await TournamentTeam.findOne({
        guildId: guild.id,
        tournamentId: tournament._id,
        $or: [
            { teamId: team._id },
            { teamNameSnapshot: team.name }
        ]
    });

    if (!tournamentTeam) {
        return reply({
            content: `❌ **${team.name}** is not linked to \`${tournament.tournamentKey}\`.`
        });
    }

    const players = await TournamentPlayer.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        $or: [
            { teamId: team._id },
            { tournamentTeamId: tournamentTeam._id },
            { teamNameSnapshot: team.name }
        ]
    }).populate('playerId');

    if (!players.length) {
        return reply({
            content:
                `❌ No tournament players found for **${team.name}** in \`${tournament.tournamentKey}\`.\n` +
                `This means TournamentPlayer entries are not linked to this team.`
        });
    }

    const emoji = tournament.emoji || trophyMeta.defaultEmoji;

    const trophyPayload = {
        tournamentId: String(tournament._id),
        tournamentKey: tournament.tournamentKey,
        tournamentName: tournament.name,

        teamId: String(team._id),
        tournamentTeamId: String(tournamentTeam._id),
        teamName: team.name,

        type,
        name: trophyMeta.label,
        label: trophyMeta.label,
        title: `${tournament.name} ${trophyMeta.label}`,
        emoji,

        awardedAt: new Date()
    };

    let awardedPlayers = 0;
    const skipped = [];

    for (const tournamentPlayer of players) {
        const globalPlayer =
            tournamentPlayer.playerId && typeof tournamentPlayer.playerId === 'object'
                ? tournamentPlayer.playerId
                : tournamentPlayer.playerId
                    ? await Player.findById(tournamentPlayer.playerId).catch(() => null)
                    : null;

        const discordID =
            tournamentPlayer.discordID ||
            globalPlayer?.discordID ||
            '';

        const displayName =
            tournamentPlayer.name ||
            tournamentPlayer.playerNameSnapshot ||
            globalPlayer?.name ||
            'Unknown Player';

        if (!discordID) {
            skipped.push(displayName);
            continue;
        }

        /*
            Important:
            Pull ALL old trophy entries for this same tournament + team before pushing the clean one.
            This removes broken older entries like:
            - Test Trophy
            - Test 🏆 Test Winner
            - undefined
        */
        await UserProfile.findOneAndUpdate(
            {
                guildId: guild.id,
                discordID
            },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    discordID,
                    allTimeStats: {
                        played: 0,
                        goals: 0,
                        assists: 0,
                        saves: 0,
                        tackles: 0,
                        interceptions: 0,
                        yc: 0,
                        rc: 0,
                        mvps: 0
                    },
                    awards: []
                },
                $set: {
                    displayName
                },
                $pull: {
                    trophies: {
                        tournamentKey: tournament.tournamentKey,
                        teamName: team.name
                    }
                }
            },
            {
                upsert: true
            }
        );

        await UserProfile.updateOne(
            {
                guildId: guild.id,
                discordID
            },
            {
                $push: {
                    trophies: trophyPayload
                }
            }
        );

        awardedPlayers++;
    }

    await Team.collection.updateOne(
        { _id: team._id },
        {
            $pull: {
                trophies: {
                    tournamentKey: tournament.tournamentKey
                }
            }
        }
    );

    await Team.collection.updateOne(
        { _id: team._id },
        {
            $push: {
                trophies: trophyPayload
            }
        }
    );

    await TournamentTeam.collection.updateOne(
        { _id: tournamentTeam._id },
        {
            $pull: {
                trophies: {
                    tournamentKey: tournament.tournamentKey
                }
            }
        }
    );

    await TournamentTeam.collection.updateOne(
        { _id: tournamentTeam._id },
        {
            $push: {
                trophies: trophyPayload
            }
        }
    );

    const embed = new EmbedBuilder()
        .setColor(type === 'champion' ? 0xF1C40F : 0xC0C0C0)
        .setTitle(`${emoji} TROPHY AWARDED`)
        .setDescription(
            `${emoji} **${tournament.name} ${trophyMeta.label}**\n\n` +
            `Team: **${team.name}**\n` +
            `Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Players found: **${players.length}**\n` +
            `Players awarded: **${awardedPlayers}**`
        )
        .setTimestamp();

    if (skipped.length) {
        embed.addFields({
            name: 'Skipped Players',
            value: skipped.slice(0, 20).join('\n'),
            inline: false
        });
    }

    return reply({
        embeds: [embed]
    });
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}
