const path = require('path');
const express = require('express');
const session = require('express-session');

const publicRoutes = require('./routes/public');
const standingsRoutes = require('./routes/standings');
const fixturesRoutes = require('./routes/fixtures');
const topStatsRoutes = require('./routes/topstats');
const playerRoutes = require('./routes/player');

function setupWeb(app, client) {
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.use(session({
        secret: process.env.SESSION_SECRET || 'change_this_secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        }
    }));

    app.use(express.static(path.join(process.cwd(), 'public')));

    app.use((req, res, next) => {
        req.client = client;
        res.locals.user = req.session.user || null;
        next();
    });

    app.use('/', publicRoutes);
    app.use('/standings', standingsRoutes);
    app.use('/fixtures', fixturesRoutes);
    app.use('/topstats', topStatsRoutes);
    app.use('/player', playerRoutes);

    app.use((req, res) => {
        res.status(404).render('error', {
            title: '404',
            message: 'Page not found.'
        });
    });
}

module.exports = { setupWeb };
