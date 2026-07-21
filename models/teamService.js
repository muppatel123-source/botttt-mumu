const {
    Team,
    Player,
    TournamentSettings
} = require('./Tournament');

async function createTeam(guildId, name, captainID, options = {}) {
    const existing = await Team.findOne({
        guildId,
        name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
    });

    if (existing) {
        throw new Error('Team already exists');
    }

    const existingCaptainTeam = await Team.findOne({
        guildId,
        captainID
    });

    if (existingCaptainTeam) {
        throw new Error('Captain already manages a team');
    }

    const team = await Team.create({
        guildId,
        name,
        shortName: options.shortName || '',
        groupKey: options.groupKey || null,
        captainID,
        logoURL: options.logoURL || '',
        color: options.color || '',
        stadium: options.stadium || '',
        stats: {
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            points: 0
        }
    });

    if (options.captainPlayerName && captainID) {
        const existingCaptainPlayer = await Player.findOne({
            guildId,
            discordID: captainID
        });

        if (!existingCaptainPlayer) {
            await Player.create({
                guildId,
                name: options.captainPlayerName,
                discordID: captainID,
                teamId: team._id,
                teamNameSnapshot: team.name,
                isCaptain: true,
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
    }

    return team;
}

async function deleteTeam(guildId, name) {
    const team = await Team.findOne({
        guildId,
        name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
    });

    if (!team) {
        return {
            deletedTeamCount: 0,
            deletedPlayerCount: 0
        };
    }

    const playerResult = await Player.deleteMany({
        guildId,
        teamId: team._id
    });

    const teamResult = await Team.deleteOne({
        _id: team._id
    });

    return {
        deletedTeamCount: teamResult.deletedCount || 0,
        deletedPlayerCount: playerResult.deletedCount || 0
    };
}

async function getTeam(guildId, name) {
    return Team.findOne({
        guildId,
        name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
    });
}

async function updateTeamStats(guildId, teamName, statChanges = {}) {
    const safeInc = normalizeTeamStats(statChanges);

    return Team.updateOne(
        {
            guildId,
            name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
        },
        {
            $inc: safeInc
        }
    );
}

async function resetTeamStats(guildId) {
    return Team.updateMany(
        {
            guildId
        },
        {
            $set: {
                'stats.played': 0,
                'stats.wins': 0,
                'stats.draws': 0,
                'stats.losses': 0,
                'stats.gf': 0,
                'stats.ga': 0,
                'stats.points': 0
            }
        }
    );
}

function normalizeTeamStats(stats = {}) {
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
    createTeam,
    deleteTeam,
    getTeam,
    updateTeamStats,
    resetTeamStats
};