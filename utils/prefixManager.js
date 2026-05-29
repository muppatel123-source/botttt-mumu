const { ServerConfig } = require('../models/Tournament');

const DEFAULT_PREFIX = '.';

async function getGuildPrefix(guildId) {
    if (!guildId) return DEFAULT_PREFIX;

    const config = await ServerConfig.collection.findOne(
        { guildId },
        {
            projection: {
                prefix: 1
            }
        }
    ).catch(() => null);

    const prefix = String(config?.prefix || '').trim();

    return prefix || DEFAULT_PREFIX;
}

async function setGuildPrefix(guildId, prefix) {
    if (!guildId) throw new Error('Missing guildId.');
    if (!prefix) throw new Error('Missing prefix.');

    const cleanPrefix = String(prefix).trim();

    await ServerConfig.collection.updateOne(
        { guildId },
        {
            $setOnInsert: {
                guildId
            },
            $set: {
                prefix: cleanPrefix,
                prefixUpdatedAt: new Date()
            }
        },
        {
            upsert: true
        }
    );

    return getGuildPrefix(guildId);
}

module.exports = {
    DEFAULT_PREFIX,
    getGuildPrefix,
    setGuildPrefix
};
