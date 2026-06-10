/**
 * nick.js
 *
 * Change a teammate's server nickname.
 * Captain or vice captain can set any teammate's nickname.
 *
 * Usage:
 *   .nick @user New Nickname Here
 *   .nick @user reset              (resets to default)
 *
 * Slash: /nick user:@user nickname:New Nickname
 *
 * PERMISSION CHECK:
 *   1. Actor must be captain or vice captain of a team
 *   2. Target must be a registered player on the SAME team
 *   3. Actor must have Manage Nicknames permission in the server
 *      (or the bot does — bot needs it regardless)
 *
 * BOT REQUIRES: ManageNicknames permission
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player
} = require('../../models/Tournament');

module.exports = {
    name: 'nick',
    description: 'Change a teammate\'s server nickname.',
    usage: '.nick @user <new nickname>  |  .nick @user reset',
    aliases: ['nickname', 'setnick', 'teamnick'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('teamnick')
        .setDescription('Change a teammate\'s server nickname')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Teammate to rename')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('nickname')
                .setDescription('New nickname, or "reset" to clear')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply(
                    '❓ Usage: `.nick @user <new nickname>` or `.nick @user reset`'
                );
            }

            // Get nickname from args after the mention
            const mentionRegex = /<@!?\d+>/;
            const afterMention = message.content.replace(mentionRegex, '').trim();
            const cleanArgs = afterMention.split(/\s+/);
            // Remove the command name (.nick)
            const nickParts = cleanArgs.filter(
                arg => !arg.startsWith('.') && !arg.startsWith('<@')
            );

            const nickname = nickParts.join(' ').trim();

            if (!nickname) {
                return message.reply(
                    '❓ Usage: `.nick @user <new nickname>` or `.nick @user reset`'
                );
            }

            return await runNick({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                nickname,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('nick prefix error:', error);
            return message.reply('❌ Failed to change nickname.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');
            const nickname = interaction.options.getString('nickname');

            return await runNick({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                nickname,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('nick slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change nickname.');
            }

            return interaction.reply({
                content: '❌ Failed to change nickname.',
                ephemeral: true
            });
        }
    }
};

/*
========================================
CORE LOGIC
========================================
*/

async function runNick({
    guild,
    actorId,
    targetUser,
    nickname,
    reply
}) {
    // ── FIND ACTOR'S TEAM ──
    const actorPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!actorPlayer?.teamId) {
        return reply({
            content: '❌ You are not linked to any team.'
        });
    }

    const team = actorPlayer.teamId;

    // ── CHECK ACTOR IS CAPTAIN OR VICE CAPTAIN ──
    const isCaptain =
        String(team.captainID) === String(actorId) ||
        actorPlayer.isCaptain;

    const isViceCaptain =
        String(team.viceCaptainID) === String(actorId) ||
        actorPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({
            content: '❌ Only the team captain or vice captain can change player nicknames.'
        });
    }

    // ── FIND TARGET PLAYER ──
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    // ── CHECK TARGET IS ON SAME TEAM ──
    if (
        !targetPlayer.teamId ||
        String(targetPlayer.teamId) !== String(team._id)
    ) {
        return reply({
            content: `❌ ${targetUser} is not in **${team.name}**. You can only rename your own teammates.`
        });
    }

    // ── CAN'T NICKNAME THE CAPTAIN (unless you ARE the captain) ──
    if (
        String(team.captainID) === String(targetUser.id) &&
        String(actorId) !== String(team.captainID)
    ) {
        return reply({
            content: '❌ Only the captain themselves can change their own nickname.'
        });
    }

    // ── RESOLVE NICKNAME ──
    const isReset = nickname.toLowerCase() === 'reset' ||
                    nickname.toLowerCase() === 'clear' ||
                    nickname.toLowerCase() === 'remove';

    const newNickname = isReset ? null : nickname.slice(0, 32);

    // ── FETCH MEMBER AND SET NICKNAME ──
    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
        return reply({
            content: `❌ Could not find ${targetUser} in this server.`
        });
    }

    try {
        await member.setNickname(newNickname);
    } catch (err) {
        if (err.code === 50013) {
            return reply({
                content:
                    '❌ Missing permission. The bot needs **Manage Nicknames** permission ' +
                    'to change nicknames. Ask a server admin to grant it.'
            });
        }

        console.error('nick setNickname error:', err);
        return reply({
            content: `❌ Failed to set nickname: ${err.message || 'Unknown error'}`
        });
    }

    // ── CONFIRM ──
    if (isReset) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🏷️ NICKNAME REMOVED')
            .setDescription(
                `Team: **${team.name}**\n` +
                `Player: ${targetUser}\n` +
                `Nickname has been reset to default.`
            )
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏷️ NICKNAME CHANGED')
        .setDescription(
            `Team: **${team.name}**\n` +
            `Player: ${targetUser}\n` +
            `New Nickname: **${newNickname}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/*
========================================
HELPERS
========================================
*/

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}
