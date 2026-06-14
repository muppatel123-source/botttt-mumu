/**
 * toggleai.js
 *
 * Enable or disable the AI feature (# questions, @mention replies,
 * reply-to-bot responses) for the entire server.
 *
 * Usage: .toggleai [on|off]
 * Slash: /toggleai state:<on|off>
 *
 * Aliases: ai, aionoff
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { ServerConfig } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'toggleai',
    description: 'Enable or disable the AI feature for this server.',
    usage: '.toggleai [on|off]',
    aliases: ['ai', 'aionoff'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.ManageGuild],

    data: new SlashCommandBuilder()
        .setName('toggleai')
        .setDescription('Enable or disable the AI feature')
        .addStringOption(opt =>
            opt.setName('state')
                .setDescription('On or Off')
                .setRequired(true)
                .addChoices(
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' }
                )
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

            const input = args[0]?.toLowerCase();
            if (!input || !['on', 'off', 'enable', 'disable'].includes(input)) {
                const config = await ServerConfig.findOne({ guildId: message.guild.id }).lean();
                const current = config?.aiEnabled !== false;
                return message.reply(
                    `🤖 AI is currently **${current ? 'ON ✅' : 'OFF ❌'}**.\n` +
                    'Usage: `.toggleai on` or `.toggleai off`'
                );
            }

            const enable = input === 'on' || input === 'enable';

            return await runToggle({
                guild: message.guild,
                enable,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[toggleai] prefix error:', error);
            return message.reply('❌ Failed to toggle AI.');
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

            const enable = interaction.options.getString('state') === 'on';

            return await runToggle({
                guild: interaction.guild,
                enable,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[toggleai] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to toggle AI.');
            }

            return interaction.reply({ content: '❌ Failed to toggle AI.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runToggle({ guild, enable, reply }) {
    await ServerConfig.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { aiEnabled: enable } },
        { upsert: true }
    );

    const embed = new EmbedBuilder()
        .setColor(enable ? 0x2ECC71 : 0xE74C3C)
        .setTitle(enable ? '🤖 AI ENABLED' : '🤖 AI DISABLED')
        .setDescription(
            enable
                ? 'AI is now active. `#` questions, @mentions, and replies will be answered.'
                : 'AI is now off. All AI responses disabled for this server.'
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
