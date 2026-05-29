const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    UserProfile,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'delete-player',
    description: 'Remove a global player and deactivate tournament entries.',
    usage: '.delete-player @user',
    aliases: ['deleteplayer', 'removeplayer', 'dp'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('delete-player')
        .setDescription('Remove a global player')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to remove')
                .setRequired(true)
        ),

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const target = message.mentions.users.first();

            if (!target) {
                return message.reply('❌ Usage: `.delete-player @user`');
            }

            return await runDeletePlayer({
                guild: message.guild,
                targetUserId: target.id,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('delete-player prefix error:', error);
            return message.reply('❌ Failed to remove player.');
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

            return await runDeletePlayer({
                guild: interaction.guild,
                targetUserId: interaction.options.getUser('user').id,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('delete-player slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply({ content: '❌ Failed to remove player.' });
            }

            return interaction.reply({
                content: '❌ Failed to remove player.',
                ephemeral: true
            });
        }
    }
};

async function runDeletePlayer({
    guild,
    targetUserId,
    reply
}) {
    const player = await Player.findOne({
        guildId: guild.id,
        discordID: targetUserId
    }).populate('teamId');

    if (!player) {
        return reply({
            content: '❌ That user is not registered as a player in this server.'
        });
    }

    const teamName =
        player.teamId?.name ||
        player.teamNameSnapshot ||
        'No Team';

    const tournamentUpdate = await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            playerId: player._id
        },
        {
            $set: {
                isActive: false
            }
        }
    );

    await Player.deleteOne({
        _id: player._id
    });

    await UserProfile.updateOne(
        {
            guildId: guild.id,
            discordID: targetUserId
        },
        {
            $set: {
                displayName: player.name
            }
        },
        {
            upsert: true
        }
    ).catch(() => null);

    const settings = await TournamentSettings.findOne({
        guildId: guild.id
    }).catch(() => null);

    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    const roleResult = await tryRemoveRole({
        guild,
        member: targetMember,
        roleId: settings?.tournamentPlayerRoleId || ''
    });

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🗑️ PLAYER REMOVED')
        .setDescription(
            `**${player.name}** has been removed globally.\n\n` +
            `👤 User: <@${targetUserId}>\n` +
            `🏟️ Team: **${teamName}**\n\n` +
            `Tournament entries deactivated: **${tournamentUpdate.modifiedCount || 0}**`
        )
        .addFields({
            name: 'Tournament Player Role',
            value: buildRoleRemovalStatus(roleResult),
            inline: false
        })
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

async function tryRemoveRole({
    guild,
    member,
    roleId
}) {
    if (!roleId) return { status: 'not_configured' };
    if (!member) return { status: 'member_missing' };

    const role = guild.roles.cache.get(roleId);
    if (!role) return { status: 'role_missing' };

    const botMember = guild.members.me;
    if (!botMember) return { status: 'bot_member_missing', role };

    if (!botMember.permissions.has('ManageRoles')) {
        return { status: 'missing_manage_roles', role };
    }

    if (!member.roles.cache.has(role.id)) {
        return { status: 'did_not_have_role', role };
    }

    if (role.managed) {
        return { status: 'managed_role', role };
    }

    if (botMember.roles.highest.position <= role.position) {
        return { status: 'role_too_high', role };
    }

    try {
        await member.roles.remove(role);
        return { status: 'removed', role };
    } catch {
        return { status: 'remove_failed', role };
    }
}

function buildRoleRemovalStatus(result) {
    switch (result.status) {
        case 'removed':
            return `Removed automatically: <@&${result.role.id}>`;
        case 'did_not_have_role':
            return 'User did not have role';
        case 'not_configured':
            return 'Not configured';
        case 'role_missing':
            return 'Configured role no longer exists';
        case 'missing_manage_roles':
            return 'Bot lacks Manage Roles permission';
        case 'role_too_high':
            return 'Role is above bot role';
        case 'managed_role':
            return 'Managed role cannot be removed';
        case 'member_missing':
            return 'Member not found';
        case 'bot_member_missing':
            return 'Bot member missing';
        case 'remove_failed':
            return 'Failed to remove role';
        default:
            return 'Unknown';
    }
}