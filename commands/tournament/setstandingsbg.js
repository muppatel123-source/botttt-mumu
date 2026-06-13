/**
 * setstandingsbg.js
 *
 * Set a custom standings background image for a tournament.
 *
 * Usage:
 *   .setstandingsbg <tournamentKey>          (with image attached to message)
 *   .setstandingsbg <tournamentKey> <url>     (direct URL)
 *   .setstandingsbg <tournamentKey> reset     (remove background)
 *
 * Organizer-only command.
 * Stores URL in TournamentSettings.standingsBackground.
 * Immediately regenerates all live standings for the tournament.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    AttachmentBuilder
} = require('discord.js');

const {
    TournamentSettings
} = require('../../models/Tournament');

const {
    isOrganizer
} = require('../../utils/isOrganizer');

const {
    getTournamentByKey,
    getDefaultTournament
} = require('../../utils/getTournament');

const {
    updateLiveStandings
} = require('../../utils/updateStandings');

const LiveMessage = require('../../models/LiveMessage');

module.exports = {
    name: 'setstandingsbg',
    description: 'Set a custom standings background image for a tournament.',
    usage: '.setstandingsbg <tournamentKey> [url|reset]  (or attach an image)',
    aliases: ['setbg', 'standingsbg', 'sbg'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setstandingsbg')
        .setDescription('Set a custom standings background image')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('url')
                .setDescription('Image URL, or "reset" to remove')
                .setRequired(false)
        )
        .addAttachmentOption(opt =>
            opt.setName('image')
                .setDescription('Upload a background image')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const tournamentKey = args[0]?.toLowerCase();

            if (!tournamentKey) {
                return message.reply(
                    '❓ Usage: `.setstandingsbg <tournamentKey> [url|reset]`\n' +
                    'Attach an image to the message, provide a URL, or use `reset` to remove.'
                );
            }

            const tournament = await resolveTournament(
                message.guild.id,
                tournamentKey
            );

            if (!tournament) {
                return message.reply(
                    `❌ Tournament \`${tournamentKey}\` not found.`
                );
            }

            // Check for "reset"
            const secondArg = args[1]?.toLowerCase();

            if (secondArg === 'reset' || secondArg === 'remove' || secondArg === 'clear') {
                return await runSetBackground({
                    client: message.client,
                    guild: message.guild,
                    tournament,
                    imageURL: null,
                    reply: payload => message.reply(payload)
                });
            }

            // Check for attached image
            const attachment = message.attachments?.first();

            if (attachment) {
                if (!isImageAttachment(attachment)) {
                    return message.reply(
                        '❌ Attached file must be an image (png, jpg, jpeg, webp, gif).'
                    );
                }

                return await runSetBackground({
                    client: message.client,
                    guild: message.guild,
                    tournament,
                    imageURL: attachment.url,
                    reply: payload => message.reply(payload)
                });
            }

            // Check for URL argument
            if (secondArg) {
                if (!isValidURL(secondArg)) {
                    return message.reply(
                        '❌ That doesn\'t look like a valid URL. Provide a direct image link or attach an image.'
                    );
                }

                return await runSetBackground({
                    client: message.client,
                    guild: message.guild,
                    tournament,
                    imageURL: secondArg,
                    reply: payload => message.reply(payload)
                });
            }

            // No image provided
            return message.reply(
                '❓ Please either:\n' +
                '• Attach an image to this message\n' +
                '• Provide an image URL: `.setstandingsbg <key> <url>`\n' +
                '• Reset with: `.setstandingsbg <key> reset`'
            );
        } catch (error) {
            console.error('[setstandingsbg] prefix error:', error);
            return message.reply('❌ Failed to set standings background.');
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

            const tournamentKey = interaction.options
                .getString('tournament')
                .toLowerCase();

            const tournament = await resolveTournament(
                interaction.guild.id,
                tournamentKey
            );

            if (!tournament) {
                return interaction.editReply(
                    `❌ Tournament \`${tournamentKey}\` not found.`
                );
            }

            // Check for uploaded image
            const attachment = interaction.options.getAttachment('image');

            if (attachment) {
                if (!isImageAttachment(attachment)) {
                    return interaction.editReply(
                        '❌ Attached file must be an image (png, jpg, jpeg, webp, gif).'
                    );
                }

                return await runSetBackground({
                    client: interaction.client,
                    guild: interaction.guild,
                    tournament,
                    imageURL: attachment.url,
                    reply: payload => interaction.editReply(payload)
                });
            }

            // Check for URL argument
            const urlArg = interaction.options.getString('url');

            if (urlArg) {
                const normalized = urlArg.toLowerCase();

                if (normalized === 'reset' || normalized === 'remove' || normalized === 'clear') {
                    return await runSetBackground({
                        client: interaction.client,
                        guild: interaction.guild,
                        tournament,
                        imageURL: null,
                        reply: payload => interaction.editReply(payload)
                    });
                }

                if (!isValidURL(urlArg)) {
                    return interaction.editReply(
                        '❌ That doesn\'t look like a valid URL.'
                    );
                }

                return await runSetBackground({
                    client: interaction.client,
                    guild: interaction.guild,
                    tournament,
                    imageURL: urlArg,
                    reply: payload => interaction.editReply(payload)
                });
            }

            return interaction.editReply(
                '❓ Provide either an image attachment or a URL. Use `reset` to remove.'
            );
        } catch (error) {
            console.error('[setstandingsbg] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply(
                    '❌ Failed to set standings background.'
                );
            }

            return interaction.reply({
                content: '❌ Failed to set standings background.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Set or remove the standings background for a tournament.
 * Immediately regenerates all live standings for this tournament.
 */
async function runSetBackground({
    client,
    guild,
    tournament,
    imageURL,
    reply
}) {
    // ── UPDATE DATABASE ──
    const updated = await TournamentSettings.findOneAndUpdate(
        {
            guildId: guild.id,
            tournamentKey: tournament.tournamentKey
        },
        {
            $set: {
                standingsBackground: imageURL || null
            }
        },
        {
            new: true
        }
    );

    if (!updated) {
        return reply({
            content: '❌ Failed to update tournament settings.'
        });
    }

    // ── REGENERATE LIVE STANDINGS ──
    // Find all live standings for this tournament and update them
    const liveMessages = await LiveMessage.find({
        guildId: guild.id,
        type: 'standings',
        tournamentKey: tournament.tournamentKey
    });

    let updatedCount = 0;

    for (const live of liveMessages) {
        const success = await updateLiveStandings(
            client,
            guild.id,
            tournament.tournamentKey,
            live.groupKey || null
        );

        if (success) updatedCount++;
    }

    // ── CONFIRMATION ──
    if (imageURL === null) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ STANDINGS BACKGROUND REMOVED')
            .setDescription(
                `Tournament: **${tournament.name}**\n` +
                `Key: \`${tournament.tournamentKey}\`\n\n` +
                `The standings will now use the default dark/gold background.\n\n` +
                `Updated **${updatedCount}/${liveMessages.length}** live standings message(s).`
            )
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🖼️ STANDINGS BACKGROUND SET')
        .setDescription(
            `Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `The custom background will be used for all standings images.\n\n` +
            `Updated **${updatedCount}/${liveMessages.length}** live standings message(s).`
        )
        .setImage(imageURL)
        .setFooter({
            text: 'Use ".setstandingsbg <key> reset" to remove.'
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   HELPERS
==================================================== */

/**
 * Resolve tournament by key, or fall back to default.
 */
async function resolveTournament(guildId, key) {
    if (key) {
        const found = await getTournamentByKey(
            guildId,
            key.toLowerCase()
        );

        if (found) return found;
    }

    return getDefaultTournament(guildId);
}

/**
 * Check if a Discord attachment is an image.
 */
function isImageAttachment(attachment) {
    if (!attachment) return false;

    const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

    if (attachment.contentType && imageTypes.includes(attachment.contentType)) {
        return true;
    }

    // Fallback: check file extension
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const filename = (attachment.name || '').toLowerCase();

    return imageExtensions.some(ext => filename.endsWith(ext));
}

/**
 * Basic URL validation.
 */
function isValidURL(str) {
    try {
        const url = new URL(str);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
