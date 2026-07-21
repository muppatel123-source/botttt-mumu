/**
 * settournamentemoji.js
 *
 * Set the emoji for a tournament.
 * Updates TournamentSettings.emoji field.
 *
 * Usage: .settournamentemoji <tournamentKey> <emoji>
 * Slash: /settournamentemoji key:<key> emoji:<emoji>
 *
 * Aliases: stemoji, tournamentemoji
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'settournamentemoji',
    description: 'Set emoji for a tournament.',
    usage: '.settournamentemoji <tournamentKey> <emoji>',
    aliases: ['stemoji', 'tournamentemoji'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('settournamentemoji')
        .setDescription('Set tournament emoji')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('emoji')
                .setDescription('Emoji or emoji code')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (args.length < 2) {
                return message.reply(
                    '❓ Usage: `.settournamentemoji <tournamentKey> <emoji>`'
                );
            }

            const key = args[0].toLowerCase();
            const emoji = args.slice(1).join(' ').trim();

            return await runCommand({
                guildId: message.guild.id,
                key,
                emoji,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[settournamentemoji] prefix error:', error);
            return message.reply('❌ Failed to set tournament emoji.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runCommand({
                guildId: interaction.guild.id,
                key: interaction.options.getString('key').toLowerCase(),
                emoji: interaction.options.getString('emoji').trim(),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[settournamentemoji] slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to set tournament emoji.');
            }

            return interaction.reply({
                content: '❌ Failed to set tournament emoji.',
                ephemeral: true
            });
        }
    }
};

async function runCommand({
    guildId,
    key,
    emoji,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId,
        tournamentKey: key
    });

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${key}\` not found.`
        });
    }

    tournament.emoji = emoji;
    await tournament.save();

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ TOURNAMENT EMOJI UPDATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `New Emoji: ${emoji}`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}