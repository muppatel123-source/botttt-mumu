const mongoose = require('mongoose');

const liveMessageSchema = new mongoose.Schema(
    {
        guildId: {
            type: String,
            required: true,
            index: true
        },

        type: {
            type: String,
            enum: ['standings', 'topstats'],
            required: true,
            index: true
        },

        /*
        ========================================
        MULTI TOURNAMENT SUPPORT
        ========================================
        */
        tournamentKey: {
            type: String,
            required: true,
            index: true
        },

        /*
        ========================================
        OPTIONAL GROUP SUPPORT
        ========================================
        */
        groupKey: {
            type: String,
            default: null
        },

        channelId: {
            type: String,
            required: true
        },

        messageId: {
            type: String,
            required: true
        }
    },
    { timestamps: true }
);

liveMessageSchema.index(
    {
        guildId: 1,
        type: 1,
        tournamentKey: 1,
        groupKey: 1
    },
    {
        unique: true
    }
);

module.exports =
    mongoose.models.LiveMessage ||
    mongoose.model('LiveMessage', liveMessageSchema);