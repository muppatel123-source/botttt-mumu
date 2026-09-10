/**
 * playerHelpers.js
 *
 * Ensure Player exists for freestyle events (auto-create)
 */

const {
    Player
} = require('../models/Tournament');

/**
 * Ensure a Player document exists for a discord ID.
 * Auto-creates if missing using guild member info.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} discordID
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function ensurePlayer(guild, discordID) {
    if (!guild || !discordID) return null;

    const cleanID = String(discordID).replace(/[<@!>]/g, '').trim();

    if (!/^\d{17,20}$/.test(cleanID)) return null;

    let player = await Player.findOne({
        guildId: guild.id,
        discordID: cleanID
    });

    if (player) return player;

    // Try to fetch member for name
    let displayName = cleanID;
    let discordUsername = null;

    try {
        const member = await guild.members.fetch(cleanID).catch(() => null);

        if (member) {
            displayName = member.displayName || member.user?.username || cleanID;
            discordUsername = member.user?.username?.toLowerCase() || null;
        } else {
            // Try client users cache
            const user = await guild.client.users.fetch(cleanID).catch(() => null);
            if (user) {
                displayName = user.username || cleanID;
                discordUsername = user.username?.toLowerCase() || null;
            }
        }
    } catch {}

    try {
        player = await Player.create({
            guildId: guild.id,
            discordID: cleanID,
            name: String(displayName).slice(0, 100),
            discordUsername,
            teamId: null,
            teamNameSnapshot: '',
            isCaptain: false,
            isViceCaptain: false,
            stats: {
                played: 0,
                goals: 0,
                assists: 0,
                saves: 0,
                tackles: 0,
                interceptions: 0,
                yc: 0,
                rc: 0,
                mvps: 0
            }
        });

        return player;
    } catch (err) {
        // Race condition: another request created it
        if (err.code === 11000) {
            return Player.findOne({ guildId: guild.id, discordID: cleanID });
        }

        console.error('[ensurePlayer] create error:', err);
        return null;
    }
}

module.exports = {
    ensurePlayer
};
