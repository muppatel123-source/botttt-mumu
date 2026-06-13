/**
 * canceldraw.js
 *
 * Cancel an active draw session. Only the organizer who started it
 * can cancel (unless --force is used by another organizer).
 *
 * Usage: .canceldraw [--force]
 * Slash: /canceldraw force:<bool>
 *
 * Aliases: abortdraw, stopdraw
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { getDrawKey, updatePublicDrawBoard } = require('../../utils/drawBoard');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'canceldraw',
    description: 'Cancel the active draw session.',
    usage: '.canceldraw [--force]',
    aliases: ['abortdraw', 'stopdraw'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('canceldraw')
        .setDescription('Cancel the active draw session')
        .addBooleanOption(opt =>
            opt.setName('force')
                .setDescription('Allow a different organizer to cancel the draw')
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

            const force = args.includes('--force');

            return await runCancelDraw({
                client: message.client,
                guild: message.guild,
                userId: message.author.id,
                force,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[canceldraw] prefix error:', error);
            return message.reply('❌ Failed to cancel draw.');
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

            return await runCancelDraw({
                client: interaction.client,
                guild: interaction.guild,
                userId: interaction.user.id,
                force: interaction.options.getBoolean('force') ?? false,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[canceldraw] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to cancel draw.');
            }

            return interaction.reply({ content: '❌ Failed to cancel draw.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Cancel the active draw session for this guild.
 * Validates ownership, updates the public board, disables buttons.
 */
async function runCancelDraw({ client, guild, userId, force, reply }) {
    const drawKey = getDrawKey(guild.id);
    const session = client.liveSettings.get(drawKey);

    if (!session || session.type !== 'manual_draw') {
        return reply({ content: '❌ No active draw session found.' });
    }

    // ── Ownership check ──
    if (session.startedBy !== userId && !force) {
        return reply({
            content:
                '🚫 Only the organizer who started the draw can cancel it.\n' +
                'Use `--force` or slash `force:true` if another organizer should stop it.'
        });
    }

    // ── Mark session as cancelled ──
    session.status = 'cancelled';
    session.cancelledAt = Date.now();
    session.cancelledBy = userId;

    // ── Update public board and disable buttons ──
    await updatePublicDrawBoard(client, session).catch(() => null);
    await disableBoardButtons(client, session).catch(() => null);

    client.liveSettings.delete(drawKey);

    // ── Response ──
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🛑 DRAW CANCELLED')
        .setDescription(
            `The active **${session.stage}** draw has been cancelled.\n\n` +
            `Started by: <@${session.startedBy}>\n` +
            `Cancelled by: <@${userId}>`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   BOARD CLEANUP
==================================================== */

/**
 * Disable all buttons on the public draw board message.
 */
async function disableBoardButtons(client, session) {
    if (!session.boardChannelId || !session.boardMessageId) return;

    const channel = await client.channels.fetch(session.boardChannelId).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(session.boardMessageId).catch(() => null);
    if (!msg) return;

    const disabledComponents = msg.components.map(row => ({
        type: 1,
        components: row.components.map(component => ({
            ...component.data,
            disabled: true
        }))
    }));

    await msg.edit({ components: disabledComponents }).catch(() => null);
}
