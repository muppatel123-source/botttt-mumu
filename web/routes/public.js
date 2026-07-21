const express = require('express');
const router = express.Router();

const {
    Team,
    Player,
    Fixture,
    TournamentSettings
} = require('../../models/Tournament');

router.get('/', async (req, res) => {
    try {
        const guildId = req.query.guild || null;

        const query = guildId ? { guildId } : {};

        const [settings, teams, players, fixtures, playedFixtures] = await Promise.all([
            guildId ? TournamentSettings.findOne({ guildId }) : TournamentSettings.findOne().sort({ updatedAt: -1 }),
            Team.countDocuments(query),
            Player.countDocuments(query),
            Fixture.countDocuments(query),
            Fixture.countDocuments({ ...query, status: 'Played' })
        ]);

        res.render('home', {
            title: 'HandFootball League',
            settings,
            stats: {
                teams,
                players,
                fixtures,
                playedFixtures
            }
        });
    } catch (error) {
        console.error('home route error:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load homepage.'
        });
    }
});

module.exports = router;