/**
 * getEvent.js
 *
 * Helpers for freestyle Event system (UCL etc)
 * Channel-bound, no teams, tracked via .as / .setmvp
 */

const {
    EventSettings
} = require('../models/Tournament');

async function getEventByKey(guildId, key) {
    if (!guildId || !key) return null;

    return EventSettings.findOne({
        guildId,
        eventKey: String(key).toLowerCase()
    });
}

function isEmptyId(id) {
    return !id || String(id).trim() === '';
}

async function getEventByChannel(guildId, channelId) {
    if (!guildId || isEmptyId(channelId)) return null;

    return EventSettings.findOne({
        guildId,
        channelId: String(channelId),
        isActive: true
    });
}

async function getSelectableEvents(guildId, options = {}) {
    if (!guildId) return [];

    const query = { guildId };

    if (options.onlyActive) {
        query.isActive = true;
    }

    return EventSettings.find(query)
        .sort({ createdAt: -1 })
        .lean();
}

async function getDefaultEventForChannel(guildId, channelId) {
    if (!guildId || !channelId) return null;

    // Exact channel match first
    const byChannel = await EventSettings.findOne({
        guildId,
        channelId: String(channelId),
        isActive: true
    });

    if (byChannel) return byChannel;

    return null;
}

/**
 * Resolve event from key OR channel binding
 * Priority: explicit key > channel-bound
 */
async function resolveEvent(guildId, key, channelId) {
    if (key) {
        const byKey = await getEventByKey(guildId, key);
        if (byKey) return byKey;
    }

    if (channelId) {
        const byChannel = await getEventByChannel(guildId, channelId);
        if (byChannel) return byChannel;
    }

    return null;
}

module.exports = {
    getEventByKey,
    getEventByChannel,
    getSelectableEvents,
    getDefaultEventForChannel,
    resolveEvent
};
