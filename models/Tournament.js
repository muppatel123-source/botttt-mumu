const mongoose = require('mongoose');

/*
========================================
TOURNAMENT SETTINGS / TOURNAMENT
One server can now have multiple tournaments.
========================================
*/
const tournamentSettingsSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        tournamentKey: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
        },

        organizerIds: {
            type: [String],
            default: []
        },

        name: {
            type: String,
            default: 'HandFootball Season'
        },

        formatType: {
            type: String,
            enum: ['league', 'groups_knockout', 'mega_table_playoffs', 'custom'],
            default: 'league'
        },

        schedulingMode: {
            type: String,
            enum: ['auto', 'manual_draw', 'hybrid'],
            default: 'auto'
        },

        teamCount: {
            type: Number,
            default: 0,
            min: 0
        },

        groupCount: {
            type: Number,
            default: 0,
            min: 0
        },

        teamsPerGroup: {
            type: Number,
            default: 0,
            min: 0
        },

        qualificationSpotsPerGroup: {
            type: Number,
            default: 2
        },

        uclQualificationSpots: {
            type: Number,
            default: 0
        },

        standingsBackground: {
            type: String,
            default: null
        },

        homeAway: {
            type: Boolean,
            default: false
        },

        hasKnockout: {
            type: Boolean,
            default: false
        },

        knockoutRounds: {
            type: [String],
            default: []
        },

        twoLeggedRounds: {
            type: [String],
            default: []
        },

        finalNeutralVenue: {
            type: Boolean,
            default: true
        },

        currentPhase: {
            type: String,
            enum: ['registration', 'league', 'groups', 'knockout', 'completed'],
            default: 'registration'
        },

        registrationOpen: {
            type: Boolean,
            default: true
        },

        captainRoleId: {
            type: String,
            default: ''
        },

        tournamentPlayerRoleId: {
            type: String,
            default: ''
        },

        manualGroupDraw: {
            type: Boolean,
            default: false
        },

        manualKnockoutDraw: {
            type: Boolean,
            default: false
        },

        autoGenerateGroupFixtures: {
            type: Boolean,
            default: false
        },

        autoSeedKnockouts: {
            type: Boolean,
            default: false
        },

        pointsWin: {
            type: Number,
            default: 3
        },

        pointsDraw: {
            type: Number,
            default: 1
        },

        pointsLoss: {
            type: Number,
            default: 0
        },

        emoji: {
            type: String,
            default: '🏆'
        }
    },
    { timestamps: true }
);

tournamentSettingsSchema.index(
    { guildId: 1, tournamentKey: 1 },
    { unique: true }
);

/*
========================================
TEAM
Server-wide team. NOT tournament-specific.
========================================
*/
const teamSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        shortName: {
            type: String,
            default: ''
        },

        groupKey: {
            type: String,
            default: null
        },

        captainID: {
            type: String,
            default: null
        },

        viceCaptainID: {
            type: String,
            default: null
        },

        logoURL: {
            type: String,
            default: ''
        },

        color: {
            type: String,
            default: ''
        },

        stadium: {
            type: String,
            default: ''
        },

        // LEGACY / current league backup.
        // Do not delete yet.
        stats: {
            played: { type: Number, default: 0 },
            wins: { type: Number, default: 0 },
            draws: { type: Number, default: 0 },
            losses: { type: Number, default: 0 },
            gf: { type: Number, default: 0 },
            ga: { type: Number, default: 0 },
            points: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

teamSchema.index({ guildId: 1, name: 1 }, { unique: true });

/*
========================================
PLAYER
Server-wide player. NOT tournament-specific.
========================================
*/
const playerSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        discordID: {
            type: String,
            default: null
        },

        teamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Team',
            default: null
        },

        teamNameSnapshot: {
            type: String,
            default: ''
        },

        isCaptain: {
            type: Boolean,
            default: false
        },

        isViceCaptain: {
            type: Boolean,
            default: false
        },

        // LEGACY / current league backup.
        // Do not delete yet.
        stats: {
            played: { type: Number, default: 0 },
            goals: { type: Number, default: 0 },
            assists: { type: Number, default: 0 },
            saves: { type: Number, default: 0 },
            tackles: { type: Number, default: 0 },
            interceptions: { type: Number, default: 0 },
            yc: { type: Number, default: 0 },
            rc: { type: Number, default: 0 },
            mvps: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

playerSchema.index(
    { guildId: 1, discordID: 1 },
    {
        unique: true,
        partialFilterExpression: { discordID: { $type: 'string' } }
    }
);

/*
========================================
TOURNAMENT TEAM
A team entry inside one tournament.
This stores tournament-specific table stats.
========================================
*/
const tournamentTeamSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        tournamentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TournamentSettings',
            required: true,
            index: true
        },

        teamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Team',
            required: true,
            index: true
        },

        teamNameSnapshot: {
            type: String,
            default: ''
        },

        groupKey: {
            type: String,
            default: null
        },

        isActive: {
            type: Boolean,
            default: true
        },

        stats: {
            played: { type: Number, default: 0 },
            wins: { type: Number, default: 0 },
            draws: { type: Number, default: 0 },
            losses: { type: Number, default: 0 },
            gf: { type: Number, default: 0 },
            ga: { type: Number, default: 0 },
            points: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

tournamentTeamSchema.index(
    { guildId: 1, tournamentId: 1, teamId: 1 },
    { unique: true }
);

/*
========================================
TOURNAMENT PLAYER
A player entry inside one tournament.
This stores tournament-specific player stats.
========================================
*/
const tournamentPlayerSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        tournamentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TournamentSettings',
            required: true,
            index: true
        },

        playerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Player',
            required: true,
            index: true
        },

        teamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Team',
            default: null,
            index: true
        },

        playerNameSnapshot: {
            type: String,
            default: ''
        },

        teamNameSnapshot: {
            type: String,
            default: ''
        },

        isActive: {
            type: Boolean,
            default: true
        },

        isCaptain: {
            type: Boolean,
            default: false
        },

        isViceCaptain: {
            type: Boolean,
            default: false
        },

        stats: {
            played: { type: Number, default: 0 },
            goals: { type: Number, default: 0 },
            assists: { type: Number, default: 0 },
            saves: { type: Number, default: 0 },
            tackles: { type: Number, default: 0 },
            interceptions: { type: Number, default: 0 },
            yc: { type: Number, default: 0 },
            rc: { type: Number, default: 0 },
            mvps: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

tournamentPlayerSchema.index(
    { guildId: 1, tournamentId: 1, playerId: 1 },
    { unique: true }
);

/*
========================================
FIXTURE
Tournament-specific fixture.
========================================
*/
const fixtureSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        tournamentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TournamentSettings',
            default: null,
            index: true
        },

        tournamentKey: {
            type: String,
            default: '',
            index: true
        },

        phase: {
            type: String,
            enum: [
                'league',
                'group',
                'qualifier',
                'eliminator',
                'quarterfinal',
                'semifinal',
                'final',
                'custom'
            ],
            required: true
        },

        roundLabel: {
            type: String,
            default: ''
        },

        groupKey: {
            type: String,
            default: null
        },

        leg: {
            type: Number,
            default: 1
        },

        matchNumber: {
            type: Number,
            default: 0
        },

        homeTeamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Team',
            default: null
        },

        awayTeamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Team',
            default: null
        },

        homeTournamentTeamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TournamentTeam',
            default: null
        },

        awayTournamentTeamId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TournamentTeam',
            default: null
        },

        homeTeam: {
            type: String,
            required: true,
            trim: true
        },

        awayTeam: {
            type: String,
            required: true,
            trim: true
        },

        venueType: {
            type: String,
            enum: ['home', 'away', 'neutral'],
            default: 'home'
        },

        venueName: {
            type: String,
            default: ''
        },

        scheduledAt: {
            type: Date,
            default: null
        },

        status: {
            type: String,
            enum: ['Pending', 'Live', 'Played', 'Cancelled'],
            default: 'Pending'
        },

        result: {
            home: { type: Number, default: null },
            away: { type: Number, default: null },
            extraTimeHome: { type: Number, default: null },
            extraTimeAway: { type: Number, default: null },
            penaltiesHome: { type: Number, default: null },
            penaltiesAway: { type: Number, default: null },
            winner: { type: String, default: '' }
        },

        aggregateTieKey: {
            type: String,
            default: null
        },

        notes: {
            type: String,
            default: ''
        },

        bracket: {
            advancesToMatchNumber: {
                type: Number,
                default: null
            },
            slot: {
                type: String,
                default: ''
            }
        }
    },
    { timestamps: true }
);

fixtureSchema.index({ guildId: 1, tournamentId: 1, matchNumber: 1 });
fixtureSchema.index({ guildId: 1, tournamentId: 1, status: 1 });
fixtureSchema.index({ guildId: 1, tournamentId: 1, phase: 1, roundLabel: 1 });

/*
========================================
USER PROFILE
All-time stats + awards + trophies.
========================================
*/
const userProfileSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        discordID: {
            type: String,
            required: true,
            index: true
        },

        displayName: {
            type: String,
            default: ''
        },

        allTimeStats: {
            played: { type: Number, default: 0 },
            goals: { type: Number, default: 0 },
            assists: { type: Number, default: 0 },
            saves: { type: Number, default: 0 },
            tackles: { type: Number, default: 0 },
            interceptions: { type: Number, default: 0 },
            mvps: { type: Number, default: 0 }
        },

        trophies: [
            {
                tournamentId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'TournamentSettings',
                    default: null
                },
                tournamentKey: String,
                tournamentName: String,
                teamName: String,
                title: String,
                awardedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],

        awards: [
            {
                tournamentId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'TournamentSettings',
                    default: null
                },
                tournamentKey: String,
                tournamentName: String,
                awardType: {
                    type: String,
                    enum: ['ballon_dor', 'golden_boot', 'golden_glove', 'playmaker']
                },
                title: String,
                awardedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ]
    },
    { timestamps: true }
);

userProfileSchema.index(
    { guildId: 1, discordID: 1 },
    { unique: true }
);

/*
========================================
SERVER CONFIG
Server-wide settings, not tournament-specific.
========================================
*/
const serverConfigSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },

        defaultTournamentKey: {
            type: String,
            default: ''
        },

        organizerIds: {
            type: [String],
            default: []
        },

        emojis: {
            stats: {
            played: { type: String, default: '<:Stadium:1487010283506630776>' },
            goals: { type: String, default: '<:Goal:1488855482142556180>' },
            assists: { type: String, default: '<:Assist:1488530563500605532>' },
            saves: { type: String, default: '<:saves:1488530642127028358>' },
            tackles: { type: String, default: '<:tackles:1488530871668703255>' },
            interceptions: { type: String, default: '🧠' },
            mvps: { type: String, default: '<:mvp:1488530468184920195>' },
            ga: { type: String, default: '🔥' }
    },

            awards: {
            ballon_dor: { type: String, default: '🏆' },
            golden_boot: { type: String, default: '⚽' },
            golden_glove: { type: String, default: '🧤' },
            playmaker: { type: String, default: '🎯' }
    },

            trophy: {
            default: { type: String, default: '🏆' }
    }
        }
    },
    { timestamps: true }
);

/*
========================================
BLACKLIST
========================================
*/
const blacklistSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true
        },

        reason: {
            type: String,
            default: ''
        },

        date: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

module.exports = {
    TournamentSettings: mongoose.models.TournamentSettings || mongoose.model('TournamentSettings', tournamentSettingsSchema),
    Team: mongoose.models.Team || mongoose.model('Team', teamSchema),
    Player: mongoose.models.Player || mongoose.model('Player', playerSchema),
    TournamentTeam: mongoose.models.TournamentTeam || mongoose.model('TournamentTeam', tournamentTeamSchema),
    TournamentPlayer: mongoose.models.TournamentPlayer || mongoose.model('TournamentPlayer', tournamentPlayerSchema),
    Fixture: mongoose.models.Fixture || mongoose.model('Fixture', fixtureSchema),
    UserProfile: mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema),
    ServerConfig: mongoose.models.ServerConfig || mongoose.model('ServerConfig', serverConfigSchema),
    Blacklist: mongoose.models.Blacklist || mongoose.model('Blacklist', blacklistSchema)
};
