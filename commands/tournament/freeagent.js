const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'freeagent',
    description: 'Make a player a free agent without deleting stats.',
    usage: '.freeagent @user',
    aliases: ['fa', 'makefreeagent'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('freeagent')
        .setDescription('Make a player a free agent without deleting stats')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to make free agent')
                .setRequired(true)
        ),

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.freeagent @user`');
            }

            return await runFreeAgent({
                guild: message.guild,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('freeagent prefix error:', error);
            return message.reply('❌ Failed to make player free agent.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply();

            const target = interaction.options.getUser('user');

            return await runFreeAgent({
                guild: interaction.guild,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('freeagent slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to make player free agent.');
            }

            return interaction.reply({
                content: '❌ Failed to make player free agent.',
                ephemeral: true
            });
        }
    }
};

async function runFreeAgent({
    guild,
    targetUser,
    reply
}) {
    const player = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!player) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    const oldTeam = player.teamId || null;

    if (!oldTeam) {
        return reply({
            content: `❌ ${targetUser} is already a **FREE AGENT**.`
        });
    }

    if (player.isCaptain || String(oldTeam.captainID) === String(targetUser.id)) {
        return reply({
            content:
                `❌ ${targetUser} is captain of **${oldTeam.name}**.\n` +
                `Change captain first with \`.cc @newCaptain\`, then try again.`
        });
    }

    const updatedTournamentPlayers = await makePlayerFreeAgent({
        guildId: guild.id,
        playerId: player._id
    });

    await Player.updateOne(
        { _id: player._id },
        {
            $set: {
                teamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false
            }
        }
    );

const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('✅ Free Agent Updated')
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