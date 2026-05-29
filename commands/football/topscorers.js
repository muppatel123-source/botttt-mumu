const { EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'topscorers',
    aliases: ['scorers', 'goldenboot'],
    description: 'View the top scorers for a specific league.',
    usage: '<league_code>',
    examples: ['.topscorers PD', '.scorers PL'],
    async execute(message, args) {
        if (!args.length) {
            const helpCmd = message.client.commands.get('help');
            return helpCmd.execute(message, [this.name]);
        }

        const leagueCode = args[0].toUpperCase();
        const headers = { 'X-Auth-Token': process.env.FOOTBALL_API_KEY };

        try {
            const res = await axios.get(`https://api.football-data.org/v4/competitions/${leagueCode}/scorers`, { headers });
            const scorers = res.data.scorers.slice(0, 10); // Top 10

            const embed = new EmbedBuilder()
                .setColor(0xFEBE10)
                .setTitle(`<a:footballg:1486727534576930846> Top Scorers: ${res.data.competition.name}`)
                .setThumbnail(res.data.competition.emblem);

            const scorerList = scorers.map((s, i) => {
                let medal = `${i + 1}.`;
                if (i === 0) medal = '🥇';
                if (i === 1) medal = '🥈';
                if (i === 2) medal = '🥉';
                return `${medal} **${s.player.name}** (${s.team.shortName})\n⚽ **${s.goals}** Goals | 🅰️ **${s.assists || 0}** Assists`;
            }).join('\n\n');

            embed.setDescription(scorerList || 'No scorer data available.');
            message.reply({ embeds: [embed] });

        } catch (e) {
            message.reply("<a:error:1486745155775234309> Could not fetch scorers. Use codes like PL, PD, BL1.");
        }
    },
};