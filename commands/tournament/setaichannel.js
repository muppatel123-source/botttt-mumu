/**
 * setaichannel.js
 *
 * Toggle a channel as "AI only" — no commands allowed,
 * but the # AI responses and bot mentions still work.
 *
 * Usage: .setaichannel [#channel]
 * Slash: /setaichannel channel:<channel>
 *
 * Aliases: aichannel, setai
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType
} = require('discord.js');

const { ServerConfig } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setaichannel',
    description: 'Toggle AI-only mode in a channel (no commands, AI still responds).',
    usage: '.setaichannel [#channel]',
    aliases: ['aichannel', 'setai'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.ManageChannels],

    data: new SlashCommandBuilder()
        .setName('setaichannel')
        .setDescription('Toggle AI-only mode in a channel')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to toggle (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
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

            const channel = message.mentions.channels.first()
                || (args[0] ? message.guild.channels.cache.get(args[0]) : null)
                || message.channel;

            return await runToggle({
                guild: message.guild,
                channel,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setaichannel] prefix error:', error);
            return message.reply('❌ Failed to toggle AI channel.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const channel = interaction.options.getChannel('channel') || interaction.channel;

            return await runToggle({
                guild: interaction.guild,
                channel,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setaichannel] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to toggle AI channel.');
            }

            return interaction.reply({ content: '❌ Failed to toggle AI channel.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runToggle({ guild, channel, reply }) {
    const config = await ServerConfig.findOne({ guildId: guild.id });

    const current = config?.aiOnlyChannels || [];

    const isActive = current.includes(channel.id);

    if (isActive) {
        // Remove
        await ServerConfig.findOneAndUpdate(
            { guildId: guild.id },
            { $pull: { aiOnlyChannels: channel.id } },
            { upsert: true }
        );

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🔓 AI-ONLY MODE DISABLED')
            .setDescription(
                `<#${channel.id}> is back to normal.\n` +
                'Commands are now allowed again.'
            )
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    // Add
    await ServerConfig.findOneAndUpdate(
        { guildId: guild.id },
        { $addToSet: { aiOnlyChannels: channel.id } },
        { upsert: true }
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🤖 AI-ONLY MODE ENABLED')
        .setDescription(
            `<#${channel.id}> is now AI-only.\n\n` +
            '• ❌ All bot commands are disabled\n' +
            '• ✅ `#` AI questions still work\n' +
            '• ✅ @bot mentions still get AI replies\n\n' +
            `Run again to disable.`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
