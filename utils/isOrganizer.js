const {
    PermissionsBitField
} = require('discord.js');

const {
    ServerConfig,
    TournamentSettings
} = require('../models/Tournament');

const OWNER_IDS = [
    '860525870804631592',
    '1487768789570556064',
    '856556430370930738'
];

async function isOrganizer(guildOrGuildId, userId) {
    if (!userId) return false;

    // Bot owners always organizer
    if (OWNER_IDS.includes(String(userId))) {
        return true;
    }

    const guildId =
        typeof guildOrGuildId === 'string'
            ? guildOrGuildId
            : guildOrGuildId?.id;

    if (!guildId) return false;

    // Server owner/admin fallback, only works if a guild object is passed
    if (typeof guildOrGuildId !== 'string') {
        const guild = guildOrGuildId;

        if (guild.ownerId === userId) {
            return true;
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }
    }

    // New correct organizer storage
    const config = await ServerConfig.findOne({ guildId }).lean().catch(() => null);

    if (config?.organizerIds?.map(String).includes(String(userId))) {
        return true;
    }

    // Backward compatibility for old storage, just in case older commands saved here
    const settingsDocs = await TournamentSettings.find({ guildId })
        .select('organizerIds organizers')
        .lean()
        .catch(() => []);

    for (const settings of settingsDocs) {
        if (settings?.organizerIds?.map(String).includes(String(userId))) {
            return true;
        }

        if (settings?.organizers?.map(String).includes(String(userId))) {
            return true;
        }
    }

    return false;
}

module.exports = {
    isOrganizer,
    OWNER_IDS
};
