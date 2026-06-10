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

module.exports = {
    name: 'changecaptain',
    description: 'Change captain of your team.',
    usage: '.cc @user',
    aliases: ['cc', 'captainchange', 'changecaptain'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('changecaptain')
        .setDescription('Change captain of your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('New captain')
                .setRequired(true)
        ),

    async execute(message) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.cc @user`');
            }

            return await runChangeCaptain({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('changecaptain prefix error:', error);
            return message.reply('❌ Failed to change captain.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');

            return await runChangeCaptain({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('changecaptain slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change captain.');
            }

            return interaction.reply({
                content: '❌ Failed to change captain.',
                ephemeral: true
            });
        }
    }
};

async function runChangeCaptain({
    guild,
    actorId,
    targetUser,
    reply
}) {
    if (actorId === targetUser.id) {
        return reply({
            content: '❌ You are already trying to make yourself captain.'
        });
    }

    const oldCaptainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!oldCaptainPlayer?.teamId) {
        return reply({
            content: '❌ You are not linked to any team.'
        });
    }

    const team = oldCaptainPlayer.teamId;

    const isCaptain =
        String(team.captainID) === String(actorId) ||
        oldCaptainPlayer.isCaptain;

    const isViceCaptain =
        String(team.viceCaptainID) === String(actorId) ||
        oldCaptainPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({
            content: '❌ Only the team captain or vice captain can use `.cc`.'
        });
    }

    const newCaptainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!newCaptainPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    if (!newCaptainPlayer.teamId || String(newCaptainPlayer.teamId) !== String(team._id)) {
        return reply({
            content:
                `❌ ${targetUser} is not in **${team.name}**.\n` +
                'Captaincy can only be given to a player from the same team.'
        });
    }

    await Team.updateOne(
        { _id: team._id },
        {
            $set: {
                captainID: targetUser.id,
                viceCaptainID: null
            }
        }
    );

    await Player.updateMany(
        {
            guildId: guild.id,
            teamId: team._id
        },
        {
            $set: {
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    await Player.updateOne(
        {
            guildId: guild.id,
            discordID: targetUser.id
        },
        {
            $set: {
                isCaptain: true,
                isViceCaptain: false
            }
        }
    );

    await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            teamId: team._id
        },
        {
            $set: {
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            playerId: newCaptainPlayer._id
        },
        {
            $set: {
                isCaptain: true,
                isViceCaptain: false
            }
        }
    );

    await moveCaptainRole({
        guild,
        oldCaptainId: actorId,
        newCaptainId: targetUser.id
    });

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('👑 CAPTAIN CHANGED')
        .setDescription(
            `Team: **${team.name}**\n\n` +
            `Old Captain: <@${actorId}>\n` +
            `New Captain: ${targetUser}`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

async function moveCaptainRole({
    guild,
    oldCaptainId,
    newCaptainId
}) {
    const settings = await TournamentSettings.find({
        guildId: guild.id,
        captainRoleId: {
            $exists: true,
            $ne: ''
        }
    }).lean();

    const roleIds = [
        ...new Set(
            settings
                .map(t => t.captainRoleId)
                .filter(Boolean)
        )
    ];

    if (!roleIds.length) return;

    const oldMember = await guild.members.fetch(oldCaptainId).catch(() => null);
    const newMember = await guild.members.fetch(newCaptainId).catch(() => null);

    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        if (oldMember?.roles.cache.has(roleId)) {
            await oldMember.roles.remove(roleId).catch(() => null);
        }

        if (newMember && !newMember.roles.cache.has(roleId)) {
            await newMember.roles.add(roleId).catch(() => null);
        }
    }
}

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}