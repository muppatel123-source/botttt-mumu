const express = require('express');
const router = express.Router();

const { Player, TournamentSettings } = require('../../models/Tournament');

const CATEGORIES = [
    { key: 'goals', label: 'Goals', emoji: '⚽' },
    { key: 'assists', label: 'Assists', emoji: '🎯' },
    { key: 'saves', label: 'Saves', emoji: '🧤' },
    { key: 'tackles', label: 'Tackles', emoji: '🛡️' },
    { key: 'interceptions', label: 'Interceptions', emoji: '🧠' },
    { key: 'mvps', label: 'MVPs', emoji: '👑' }
];

router.get('/', async (req, res) => {
    try {
        const guildId = req.query.guild || null;

        const settings = guildId
            ? await TournamentSettings.findOne({ guildId })
            : await TournamentSettings.findOne().sort({ updatedAt: -1 });

        const finalGuildId = guildId || settings?.guildId;

        const players = finalGuildId
            ? await Player.find({ guildId: finalGuildId }).lean()
            : [];

        const leaderboards = CATEGORIES.map(category => {
            const rows = players
                .filter(p => (p.stats?.[category.key] || 0) > 0)
                .sort((a, b) => {
                    const diff = (b.stats?.[category.key] || 0) - (a.stats?.[category.key] || 0);
                    if (diff !== 0) return diff;
                    return (a.stats?.played || 0) - (b.stats?.played || 0);
                })
                .slice(0, 10);

            return {
                ...category,
                rows
            };
        });

        res.render('topstats', {
            title: 'Top Stats',
            settings,
            leaderboards
        });
    } catch (error) {
        console.error('topstats route error:', error);

        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load top stats.'
        });
    }
});

module.exports = router;
