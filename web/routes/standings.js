const express = require('express');
const router = express.Router();

const { Team, TournamentSettings } = require('../../models/Tournament');

router.get('/', async (req, res) => {
    try {
        const guildId = req.query.guild || null;
        const query = guildId ? { guildId } : {};

        const settings = guildId
            ? await TournamentSettings.findOne({ guildId })
            : await TournamentSettings.findOne().sort({ updatedAt: -1 });

        const finalGuildId = guildId || settings?.guildId;

        const teams = finalGuildId
            ? await Team.find({ guildId: finalGuildId }).lean()
            : [];

        const sorted = teams.sort((a, b) => {
            const as = a.stats || {};
            const bs = b.stats || {};

            if ((bs.points || 0) !== (as.points || 0)) return (bs.points || 0) - (as.points || 0);

            const agd = (as.gf || 0) - (as.ga || 0);
            const bgd = (bs.gf || 0) - (bs.ga || 0);
            if (bgd !== agd) return bgd - agd;

            if ((bs.gf || 0) !== (as.gf || 0)) return (bs.gf || 0) - (as.gf || 0);

            return a.name.localeCompare(b.name);
        });

        res.render('standings', {
            title: 'Standings',
            settings,
            teams: sorted
        });
    } catch (error) {
        console.error('standings route error:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load standings.'
        });
    }
});

module.exports = router;
