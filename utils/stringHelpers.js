/**
 * stringHelpers.js
 *
 * Shared string utilities used across tournament commands.
 *
 * getUserFromArgs resolves a target user from:
 *   1. @mention          — extracts ID from message content
 *   2. Raw Discord ID    — numeric 17-20 digit string
 *   3. Discord username  — case-insensitive lookup in Player DB
 *
 * All three input methods return a Discord User object.
 */

// Player is loaded lazily inside getUserFromArgs to avoid circular dependency issues

/**
 * Escape special regex characters in a string.
 * Used for case-insensitive team name lookups.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeRegex(text) {
    return String(text || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Resolve a target Discord user from message args.
 *
 * Resolution order:
 *   1. @mention in message content → extract ID → fetch user
 *   2. Raw Discord ID (17-20 digits) → fetch user
 *   3. Username string → search Player DB → fetch user by stored ID
 *
 * @param {import('discord.js').Message} message
 * @param {string[]} [args] - Optional args array. If omitted, parses from message content.
 * @returns {Promise<import('discord.js').User|null>}
 */
async function getUserFromArgs(message, args) {
    /* ── 1. Try @mention extraction ── */
    const mentionOrId = message.content.match(/\d{17,20}/)?.[0];

    if (mentionOrId) {
        try {
            const user = await message.client.users.fetch(mentionOrId);
            if (user) return user;
        } catch {}
    }

    /* ── 2. Try username lookup from args ── */
    const rawArgs = args || message.content.trim().split(/ +/).slice(1);
    const username = rawArgs.join(' ').replace(/[<@!>]/g, '').trim();

    if (!username) return null;

    /* Don't bother querying if it's just a numeric ID that already failed */
    if (/^\d{17,20}$/.test(username)) return null;

    try {
        const { Player } = require('../models/Tournament');
        const player = await Player.findOne({
            guildId: message.guild.id,
            discordUsername: username.toLowerCase()
        }).lean();

        if (player?.discordID) {
            const user = await message.client.users.fetch(player.discordID).catch(() => null);
            if (user) return user;
        }
    } catch {}

    return null;
}

/* ====================================================
   MENTION SANITIZER
   Prevents any @everyone, @here, or role ping from
   ever appearing in bot output text.
==================================================== */

/**
 * Strip all mass-mention patterns from a string.
 * - @everyone → @​everyone (zero-width space breaks it)
 * - @here     → @​here
 * - <@&ID>    → @[role]
 *
 * Apply to ANY user-provided text before the bot echoes it.
 */
function sanitizeMentions(text) {
    if (typeof text !== 'string') return text;

    return text
        // @everyone and @here — insert zero-width space after @
        .replace(/@everyone/gi, '@\u200Beveryone')
        .replace(/@here/gi, '@\u200Bhere')
        // Role pings <@&123456789>
        .replace(/<@&\d+>/g, '@[role]')
        // User pings <@123456789> (not needed to strip but won't hurt — leave them)
        // Actually, let's leave user pings alone — they're just visual links
        ;
}

/**
 * Deep-sanitize an object: clean strings in content, embeds, etc.
 * Pass any payload you're about to send/reply with.
 */
function sanitizePayload(payload) {
    if (typeof payload === 'string') return sanitizeMentions(payload);

    if (typeof payload === 'object' && payload !== null) {
        // Sanitize content field
        if (typeof payload.content === 'string') {
            payload.content = sanitizeMentions(payload.content);
        }

        // Sanitize embed descriptions and fields
        if (Array.isArray(payload.embeds)) {
            for (const embed of payload.embeds) {
                if (embed && typeof embed === 'object') {
                    if (embed.data) {
                        // EmbedBuilder instance
                        if (typeof embed.data.description === 'string') {
                            embed.data.description = sanitizeMentions(embed.data.description);
                        }
                        if (typeof embed.data.title === 'string') {
                            embed.data.title = sanitizeMentions(embed.data.title);
                        }
                        if (typeof embed.data.footer?.text === 'string') {
                            embed.data.footer.text = sanitizeMentions(embed.data.footer.text);
                        }
                        if (Array.isArray(embed.data.fields)) {
                            for (const field of embed.data.fields) {
                                if (typeof field.name === 'string') field.name = sanitizeMentions(field.name);
                                if (typeof field.value === 'string') field.value = sanitizeMentions(field.value);
                                if (typeof field.inline !== 'boolean') delete field.inline;
                            }
                        }
                        if (typeof embed.data.author?.name === 'string') {
                            embed.data.author.name = sanitizeMentions(embed.data.author.name);
                        }
                    } else {
                        // Plain embed object
                        if (typeof embed.description === 'string') {
                            embed.description = sanitizeMentions(embed.description);
                        }
                        if (typeof embed.title === 'string') {
                            embed.title = sanitizeMentions(embed.title);
                        }
                        if (typeof embed.footer?.text === 'string') {
                            embed.footer.text = sanitizeMentions(embed.footer.text);
                        }
                        if (Array.isArray(embed.fields)) {
                            for (const field of embed.fields) {
                                if (typeof field.name === 'string') field.name = sanitizeMentions(field.name);
                                if (typeof field.value === 'string') field.value = sanitizeMentions(field.value);
                            }
                        }
                        if (typeof embed.author?.name === 'string') {
                            embed.author.name = sanitizeMentions(embed.author.name);
                        }
                    }
                }
            }
        }
    }

    return payload;
}

module.exports = {
    escapeRegex,
    getUserFromArgs,
    sanitizeMentions,
    sanitizePayload
};
