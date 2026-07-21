const express = require('express');
const router = express.Router();

const { Fixture, TournamentSettings } = require('../../models/Tournament');

router.get('/', async (req, res) => {
    try {
        const guildId = req.query.guild || null;

        const settings = guildId
            ? await TournamentSettings.findOne({ guildId })
            : await TournamentSettings.findOne().sort({ updatedAt: -1 });

        const finalGuildId = guildId || settings?.guildId;

        const fixtures = finalGuildId
            ? await Fixture.find({ guildId: finalGuildId }).lean()
            : [];

        fixtures.sort((a, b) => {
            const aRound = extractRoundNumber(a.roundLabel);
            const bRound = extractRoundNumber(b.roundLabel);

            if (aRound !== bRound) return aRound - bRound;

            return (a.matchNumber || 0) - (b.matchNumber || 0);
        });

        const grouped = {};

        for (const fixture of fixtures) {
            const key = fixture.roundLabel || 'Other';

            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(fixture);
        }

        res.render('fixtures', {
            title: 'Fixtures',
            settings,
            grouped
        });
    } catch (error) {
        console.error('fixtures route error:', error);

        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load fixtures.'
        });
    }
});

function extractRoundNumber(label) {
    const match = String(label || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 9999;
}

module.exports = router;
