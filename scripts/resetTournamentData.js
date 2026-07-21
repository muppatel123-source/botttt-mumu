// scripts/resetTournamentData.js

require('dotenv').config();
const mongoose = require('mongoose');

const {
  Team,
  Player,
  Fixture,
  TournamentSettings
} = require('../models/Tournament');

async function resetTournamentData() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing in your .env file');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const teamResult = await Team.deleteMany({});
    const playerResult = await Player.deleteMany({});
    const fixtureResult = await Fixture.deleteMany({});
    const settingsResult = await TournamentSettings.deleteMany({});

    console.log('🗑️ Tournament data deleted successfully:\n');
    console.log(`Teams deleted: ${teamResult.deletedCount}`);
    console.log(`Players deleted: ${playerResult.deletedCount}`);
    console.log(`Fixtures deleted: ${fixtureResult.deletedCount}`);
    console.log(`TournamentSettings deleted: ${settingsResult.deletedCount}`);

    console.log('\n✅ Reset complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to reset tournament data:', error);
    process.exit(1);
  }
}

resetTournamentData();