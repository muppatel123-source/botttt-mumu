const { Fixture } = require('../../models/Tournament');

module.exports = {
    name: 'addfixtures',
    description: 'Bulk add fixtures for a matchday. Supports multi-word names.',
    hidden: true,
    
    async execute(message, args) {
        // 🔒 Authorization Check
        const auth = ["860525870804631592", "1487768789570556064", "856556430370930738"];
        if (!auth.includes(message.author.id)) return;

        // 📝 Usage: .addfixtures <Group> <Matchday> Team 1 vs Team 2, Team 3 vs Team 4
        const group = parseInt(args[0]);
        const matchday = parseInt(args[1]);
        
        if (isNaN(group) || isNaN(matchday)) {
            return message.reply("❓ **Usage:** `.addfixtures <Group> <Matchday> Team A vs Team B, Team C vs Team D`\n*Example: .addfixtures 1 1 Real Madrid vs Barcelona, Matrix FC vs Falcons*");
        }

        // Join remaining args and split by comma to get each match string
        const matchStrings = args.slice(2).join(' ').split(',');

        const fixtureData = [];
        for (let str of matchStrings) {
            // Split by "vs" (case-insensitive)
            const teams = str.split(/\s+vs\s+/i);
            if (teams.length === 2) {
                fixtureData.push({
                    guildId: message.guild.id,
                    group: group,
                    matchday: matchday,
                    team1: teams[0].trim(),
                    team2: teams[1].trim(),
                    status: 'Pending'
                });
            }
        }

        if (fixtureData.length === 0) {
            return message.reply("❌ **No valid fixtures found.** Make sure to use `vs` between teams and a comma `,` between matches.");
        }

        try {
            await Fixture.insertMany(fixtureData);
            message.reply(`✅ Successfully added **${fixtureData.length}** fixtures for Matchday **${matchday}** (Group ${group}).`);
        } catch (err) {
            console.error(err);
            message.reply("❌ **Database Error** while saving fixtures.");
        }
    }
};