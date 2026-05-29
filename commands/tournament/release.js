const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

module.exports = {
    name: 'release',
    description: 'Release a player from your team as captain.',
    usage: '.release @user',
    aliases: ['dropplayer', 'kickplayer'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('release')
        .setDescription('Release a player from your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to release')
                .setRequired(true)
        ),

    async execute(message) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.release @user`');
            }

            return await runRelease({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('release prefix error:', error);
            return message.reply('❌ Failed to release player.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('user');

            return await runRelease({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('release slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to release player.');
            }

            return interaction.reply({
                content: '❌ Failed to release player.',
                ephemeral: true
            });
        }
    }
};

async function runRelease({
    guild,
    actorId,
    targetUser,
    reply
}) {
    const captainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!captainPlayer?.teamId) {
        return reply({
            content: '❌ You are not linked to any team.'
        });
    }

    const team = captainPlayer.teamId;

    if (String(team.captainID) !== String(actorId) && !captainPlayer.isCaptain) {
        return reply({
            content: '❌ Only the team captain can release players.'
        });
    }

    if (String(actorId) === String(targetUser.id)) {
        return reply({
            content:
                '❌ You cannot release yourself while you are captain.\n' +
                'Use `.cc @newCaptain` first.'
        });
    }

    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    if (!targetPlayer.teamId || String(targetPlayer.teamId) !== String(team._id)) {
        return reply({
            content: `❌ ${targetUser} is not in **${team.name}**.`
        });
    }

    if (targetPlayer.isCaptain || String(team.captainID) === String(targetUser.id)) {
        return reply({
            content:
                `❌ ${targetUser} is the captain of **${team.name}**.\n` +
                'Use `.cc @newCaptain` first.'
        });
    }

    await Player.updateOne(
        { _id: targetPlayer._id },
        {
            $set: {
                teamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false
            }
        }
    );

    const updatedTournamentPlayers = await makePlayerFreeAgent({
        guildId: guild.id,
        playerId: targetPlayer._id
    });

const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('✅ Player Released')
    .setDescription(`${targetUser} is now a **FREE AGENT**.`)
    .setTimestamp();

    return reply({ embeds: [embed] });
}

async function makePlayerFreeAgent({
    guildId,
    playerId
}) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: {
            $ne: 'completed'
        }
    }).select('_id').lean();

    const activeTournamentIds = activeTournaments.map(t => t._id);

    if (!activeTournamentIds.length) return 0;

    const result = await TournamentPlayer.updateMany(
        {
            guildId,
            playerId,
            tournamentId: {
                $in: activeTournamentIds
            },
            isActive: true
        },
        {
            $set: {
                teamId: null,
                tournamentTeamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false
            }
        }
    );

    return result.modifiedCount || 0;
}

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}