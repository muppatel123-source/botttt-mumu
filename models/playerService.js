const { Player, Team } = require('./Tournament');

async function addPlayer(guildId, name, discordID, teamName, options = {}) {
    const team = await Team.findOne({
        guildId,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (!team) {
        throw new Error('Team not found');
    }

    const existing = await Player.findOne({
        guildId,
        discordID
    });

    if (existing) {
        throw new Error('Player already registered in this server');
    }

    return Player.create({
        guildId,
        name,
        discordID,
        teamId: team._id,
        teamNameSnapshot: team.name,
        isCaptain: Boolean(options.isCaptain),
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
}

async function removePlayer(guildId, discordID) {
    return Player.deleteOne({
        guildId,
        discordID
    });
}

async function getPlayer(guildId, discordID) {
    return Player.findOne({
        guildId,
        discordID
    }).populate('teamId');
}

async function getPlayersByTeam(guildId, teamId) {
    return Player.find({
        guildId,
        teamId
    }).sort({
        isCaptain: -1,
        name: 1
    });
}

async function addStats(guildId, discordID, stats = {}) {
    const safeInc = normalizeNestedStats(stats);

    return Player.updateOne(
        {
            guildId,
            discordID
        },
        {
            $inc: safeInc
        }
    );
}

async function resetPlayerStats(guildId, discordID) {
    return Player.updateOne(
        {
            guildId,
            discordID
        },
        {
            $set: {
                'stats.played': 0,
                'stats.goals': 0,
                'stats.assists': 0,
                'stats.saves': 0,
                'stats.tackles': 0,
                'stats.interceptions': 0,
                'stats.yc': 0,
                'stats.rc': 0,
                'stats.mvps': 0
            }
        }
    );
}

function normalizeNestedStats(stats = {}) {
    const output = {};

    for (const [key, value] of Object.entries(stats)) {
        if (typeof value !== 'number' || Number.isNaN(value)) continue;

        if (key.startsWith('stats.')) {
            output[key] = value;
        } else {
            output[`stats.${key}`] = value;
        }
    }

    return output;
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

module.exports = {
    addPlayer,
    removePlayer,
    getPlayer,
    getPlayersByTeam,
    addStats,
    resetPlayerStats
};