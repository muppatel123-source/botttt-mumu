const {
    TournamentSettings,
    ServerConfig
} = require('../models/Tournament');

async function getTournamentByKey(guildId, key, options = {}) {
    if (!guildId || !key) return null;

    const query = {
        guildId,
        tournamentKey: String(key).toLowerCase()
    };

    if (!options.includeCompleted) {
        query.currentPhase = { $ne: 'completed' };
    }

    return TournamentSettings.findOne(query);
}

async function getDefaultTournament(guildId, options = {}) {
    if (!guildId) return null;

    const config = await ServerConfig.findOne({ guildId });

    if (config?.defaultTournamentKey) {
        const byDefault = await getTournamentByKey(
            guildId,
            config.defaultTournamentKey,
            options
        );

        if (byDefault) return byDefault;
    }

    const query = { guildId };

    if (!options.includeCompleted) {
        query.currentPhase = { $ne: 'completed' };
    }

    return TournamentSettings.findOne(query).sort({
        createdAt: -1
    });
}

async function getSelectableTournaments(guildId, options = {}) {
    if (!guildId) return [];

    const query = { guildId };

    if (!options.includeCompleted) {
        query.currentPhase = { $ne: 'completed' };
    }

    return TournamentSettings.find(query)
        .sort({
            currentPhase: 1,
            createdAt: -1
        })
        .lean();
}

async function getActiveTournaments(guildId) {
    return getSelectableTournaments(guildId, {
        includeCompleted: false
    });
}

async function getAllTournaments(guildId) {
    return getSelectableTournaments(guildId, {
        includeCompleted: true
    });
}

module.exports = {
    getTournamentByKey,
    getDefaultTournament,
    getSelectableTournaments,
    getActiveTournaments,
    getAllTournaments
};
