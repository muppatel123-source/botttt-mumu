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

const { Player } = require('../models/Tournament');

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

module.exports = {
    escapeRegex,
    getUserFromArgs
};
