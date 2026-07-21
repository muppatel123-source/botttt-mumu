const {
    Team,
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer
} = require('../models/Tournament');

async function syncAllTeamsToTournament(guildId, tournament) {
    const teams = await Team.find({ guildId }).sort({ createdAt: 1 });

    let syncedTeams = 0;
    let syncedPlayers = 0;

    for (const team of teams) {
        const result = await syncTeamToTournament(guildId, tournament, team);
        if (result.teamSynced) syncedTeams++;
        syncedPlayers += result.playersSynced;
    }

    return { syncedTeams, syncedPlayers };
}

async function syncTeamToOpenTournaments(guildId, team) {
    const tournaments = await TournamentSettings.find({
        guildId,
        registrationOpen: true,
        currentPhase: 'registration'
    });

    let syncedTournaments = 0;
    let syncedPlayers = 0;

    for (const tournament of tournaments) {
        const result = await syncTeamToTournament(guildId, tournament, team);
        if (result.teamSynced) syncedTournaments++;
        syncedPlayers += result.playersSynced;
    }

    return { syncedTournaments, syncedPlayers };
}

async function syncTeamToTournament(guildId, tournament, team) {
    if (!tournament || !team) {
        return { teamSynced: false, playersSynced: 0 };
    }

    if (tournament.teamCount > 0) {
        const currentCount = await TournamentTeam.countDocuments({
            guildId,
            tournamentId: tournament._id,
            isActive: true
        });

        const alreadyExists = await TournamentTeam.findOne({
            guildId,
            tournamentId: tournament._id,
            teamId: team._id
        });

        if (!alreadyExists && currentCount >= tournament.teamCount) {
            return { teamSynced: false, playersSynced: 0, skippedReason: 'tournament_full' };
        }
    }

    await TournamentTeam.findOneAndUpdate(
        {
            guildId,
            tournamentId: tournament._id,
            teamId: team._id
        },
        {
            $set: {
                guildId,
                tournamentId: tournament._id,
                teamId: team._id,
                teamNameSnapshot: team.name,
                isActive: true
            },
            $setOnInsert: {
                groupKey: team.groupKey || null,
                stats: {
                    played: 0,
                    wins: 0,
                    draws: 0,
                    losses: 0,
                    gf: 0,
                    ga: 0,
                    points: 0
                }
            }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    );

    const players = await Player.find({
        guildId,
        teamId: team._id
    });

    let playersSynced = 0;

    for (const player of players) {
        await syncPlayerToTournament(guildId, tournament, player, team);
        playersSynced++;
    }

    return { teamSynced: true, playersSynced };
}

async function syncPlayerToOpenTournaments(guildId, player) {
    const team = player.teamId
        ? await Team.findOne({ guildId, _id: player.teamId })
        : null;

    if (!team) return { syncedTournaments: 0 };

    const tournamentTeams = await TournamentTeam.find({
        guildId,
        teamId: team._id,
        isActive: true
    }).populate('tournamentId');

    let syncedTournaments = 0;

    for (const entry of tournamentTeams) {
        if (!entry.tournamentId) continue;

        await syncPlayerToTournament(guildId, entry.tournamentId, player, team);
        syncedTournaments++;
    }

    return { syncedTournaments };
}

async function syncPlayerToTournament(guildId, tournament, player, team) {
    return TournamentPlayer.findOneAndUpdate(
        {
            guildId,
            tournamentId: tournament._id,
            playerId: player._id
        },
        {
            $set: {
                guildId,
                tournamentId: tournament._id,
                playerId: player._id,
                teamId: team?._id || player.teamId || null,
                playerNameSnapshot: player.name,
                teamNameSnapshot: team?.name || player.teamNameSnapshot || '',
                isActive: true
            },
            $setOnInsert: {
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
            }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    );
}

module.exports = {
    syncAllTeamsToTournament,
    syncTeamToOpenTournaments,
    syncTeamToTournament,
    syncPlayerToOpenTournaments,
    syncPlayerToTournament
};