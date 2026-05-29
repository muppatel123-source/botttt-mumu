const express = require('express');
const router = express.Router();

const { Player } = require('../../models/Tournament');

router.get('/:id', async (req, res) => {
    try {
        const player = await Player.findById(req.params.id)
            .populate('teamId')
            .lean();

        if (!player) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Player not found.'
            });
        }

        res.render('player', {
            title: player.name,
            player
        });

    } catch (error) {
        console.error('player page error:', error);

        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load player.'
        });
    }
});

module.exports = router;
