/**
 * toggletransfers.js
 *
 * Lock or unlock player transfers (transfer, claimplayer, release, freeagent).
 * Organizer only. Shows current status if no argument given.
 *
 * Usage:  .toggletransfers [on/off]
 * Slash:  /toggletransfers state:<on|off>
 *
 * Aliases: locktransfers, transfers, transferlock
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { ServerConfig } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'toggletransfers',
    description: 'Lock or unlock player transfers.',
    usage: '.toggletransfers [on/off]',
    aliases: ['locktransfers', 'transfers', 'transferlock'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('toggletransfers')
        .setDescription('Lock or unlock player transfers')
        .addStringOption(opt =>
            opt.setName('state')
                .setDescription('Set transfers on or off')
                .setRequired(false)
                .addChoices(
                    { name: '🔓 Open (transfers allowed)', value: 'on' },
                    { name: '🔒 Locked (transfers blocked)', value: 'off' }
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
            let newState;

            if (input === 'on' || input === 'open' || input === 'unlock') newState = false;
            else if (input === 'off' || input === 'close' || input === 'lock') newState = true;

            return await runToggle({
                guild: message.guild,
                newState,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[toggletransfers] prefix error:', error);
            return message.reply('❌ Failed to toggle transfers.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', flags: 64 });
            }

            const input = interaction.options.getString('state');
            let newState;
            if (input === 'on') newState = false;
            else if (input === 'off') newState = true;

            await interaction.deferReply({ flags: 64 });

            return await runToggle({
                guild: interaction.guild,
                newState,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[toggletransfers] slash error:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to toggle transfers.');
            }
            return interaction.reply({ content: '❌ Failed to toggle transfers.', flags: 64 });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runToggle({ guild, newState, reply }) {
    // If no argument, just show current status
    if (newState === undefined || newState === null) {
        const config = await ServerConfig.findOne({ guildId: guild.id }).lean();
        const locked = config?.transfersLocked || false;

        const embed = new EmbedBuilder()
            .setColor(locked ? 0xE74C3C : 0x2ECC71)
            .setTitle(`${locked ? '🔒' : '🔓'} Transfer Window`)
            .setDescription(
                locked
                    ? 'Transfers are currently **LOCKED**.\nPlayers cannot be transferred, claimed, released, or made free agents.'
                    : 'Transfers are currently **OPEN**.\nAll transfer commands are available.'
            )
            .setFooter({ text: `Use /toggletransfers state:${locked ? 'on' : 'off'} to change` });

        return reply({ embeds: [embed] });
    }

    // Update the setting
    await ServerConfig.findOneAndUpdate(
        { guildId: guild.id },
        { $set: { transfersLocked: newState } },
        { upsert: true, setDefaultsOnInsert: true }
    );

    const locked = newState;

    const embed = new EmbedBuilder()
        .setColor(locked ? 0xE74C3C : 0x2ECC71)
        .setTitle(`${locked ? '🔒' : '🔓'} Transfers ${locked ? 'LOCKED' : 'OPENED'}`)
        .setDescription(
            locked
                ? '**All transfer commands are now LOCKED.**\n\nBlocked commands:\n• `/transfer`\n• `/claimplayer`\n• `/release`\n• `/freeagent`'
                : '**Transfer window is now OPEN.**\n\nAll transfer commands are available again:\n• `/transfer`\n• `/claimplayer`\n• `/release`\n• `/freeagent`'
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
