/**
 * nick.js
 *
 * Change a teammate's nickname IN THE BOT (stored in the
 * Player database). Does NOT touch their server nickname.
 * Captain or VC can set any teammate's bot nickname.
 * Supports "reset" to revert to their Discord username.
 *
 * Usage:  .nick @user <new nickname>
 *         .nick @user reset
 * Slash:  /teamnick user:<user> nickname:<name>
 *
 * Aliases: nickname, setnick, teamnick
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Team, Player, TournamentPlayer } = require('../../models/Tournament');
const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'nick',
    description: 'Change a teammate\'s nickname in the bot.',
    usage: '.nick @user <new nickname>  |  .nick @user reset',
    aliases: ['nickname', 'setnick', 'teamnick'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('teamnick')
        .setDescription('Change a teammate\'s nickname in the bot')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Teammate to rename')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('nickname')
                .setDescription('New nickname, or "reset" to revert to Discord username')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❓ Usage: `.nick @user <new nickname>` or `.nick @user reset`');
            }

            // Extract nickname from args after the command and mention
            const mentionRegex = /<@!?\d+>/;
            const afterMention = message.content.replace(mentionRegex, '').trim();
            const nickParts = afterMention
                .split(/\s+/)
                .filter(arg => !arg.startsWith('.') && !arg.startsWith('<@'));

            const nickname = nickParts.join(' ').trim();

            if (!nickname) {
                return message.reply('❓ Usage: `.nick @user <new nickname>` or `.nick @user reset`');
            }

            return await runNick({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                nickname,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[nick] prefix error:', error);
            return message.reply('❌ Failed to change nickname.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

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
            console.error('[nick] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change nickname.');
            }

            return interaction.reply({ content: '❌ Failed to change nickname.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Change a teammate's nickname IN THE BOT DATABASE only.
 * Does NOT touch the Discord server nickname.
 *
 * 1. Verify actor is captain/VC of a team
 * 2. Verify target is on the same team
 * 3. Update Player.name in the database
 * 4. Update TournamentPlayer.playerNameSnapshot for active tournaments
 */
async function runNick({ guild, actorId, targetUser, nickname, reply }) {
    /* ── Find actor's team ── */
    const actorPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!actorPlayer?.teamId) {
        return reply({ content: '❌ You are not linked to any team.' });
    }

    const team = actorPlayer.teamId;

    /* ── Check actor is captain or VC ── */
    const isCaptain =
        String(team.captainID) === String(actorId) ||
        actorPlayer.isCaptain;

    const isViceCaptain =
        String(team.viceCaptainID) === String(actorId) ||
        actorPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({ content: '❌ Only the team captain or vice captain can change player nicknames.' });
    }

    /* ── Find target player ── */
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    /* ── Check target is on same team ── */
    if (!targetPlayer.teamId || String(targetPlayer.teamId) !== String(team._id)) {
        return reply({
            content: `❌ ${targetUser} is not in **${team.name}**. You can only rename your own teammates.`
        });
    }

    /* ── Can't nickname the captain (unless you ARE the captain) ── */
    if (
        String(team.captainID) === String(targetUser.id) &&
        String(actorId) !== String(team.captainID)
    ) {
        return reply({ content: '❌ Only the captain themselves can change their own nickname.' });
    }

    /* ── Resolve nickname ── */
    const isReset =
        nickname.toLowerCase() === 'reset' ||
        nickname.toLowerCase() === 'clear' ||
        nickname.toLowerCase() === 'remove';

    const newNickname = isReset ? (targetUser.username || targetUser.displayName) : nickname.slice(0, 32);

    /* ── Update Player.name in database ── */
    targetPlayer.name = newNickname;
    await targetPlayer.save();

    /* ── Update TournamentPlayer.playerNameSnapshot for active tournaments ── */
    await TournamentPlayer.updateMany(
        { playerId: targetPlayer._id },
        { $set: { playerNameSnapshot: newNickname } }
    );

    /* ── Response ── */
    if (isReset) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🏷️ NICKNAME RESET')
            .setDescription(
                `Team: **${team.name}**\n` +
                `Player: ${targetUser}\n` +
                `Bot nickname reverted to their Discord username: **${newNickname}**`
            )
            .setFooter({ text: 'Only the bot nickname was changed — server nickname is untouched.' })
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏷️ NICKNAME CHANGED')
        .setDescription(
            `Team: **${team.name}**\n` +
            `Player: ${targetUser}\n` +
            `Bot Nickname: **${newNickname}**`
        )
        .setFooter({ text: 'Only the bot nickname was changed — server nickname is untouched.' })
        .setTimestamp();

    return reply({ embeds: [embed] });
}
