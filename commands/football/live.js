const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'live',
    aliases: ['scores', 'now'],
    category: 'utilities',
    description: 'Shows live football scores across all 12 supported leagues',
    async execute(message) {
        const API_TOKEN = process.env.FOOTBALL_API_KEY;
        const headers = { 'X-Auth-Token': API_TOKEN };

        // 🟢 LEAGUE CODES (Same 12 as your standings/match commands)
        const leagueIds = ['PD', 'PL', 'CL', 'BL1', 'SA', 'FL1', 'DED', 'PPL', 'ELC', 'BSA', 'CLI', 'EC'];

        const embed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('<:satelliteantennamicrosoft:1486798951951761511>  Fetching Live Scores...')
            .setDescription('Checking all 12 leagues for active matches...');

        const msg = await message.reply({ embeds: [embed] });

        try {
            // Fetch ALL matches currently in play across the whole API
            // Filtering by 'LIVE' and 'IN_PLAY'
            const response = await axios.get(`https://api.football-data.org/v4/matches?status=LIVE`, { headers });
            const liveMatches = response.data.matches.filter(m => leagueIds.includes(m.competition.code));

            if (liveMatches.length === 0) {
                const noLiveEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('<:Waiting:1486799175596376085> No Live Matches')
                    .setDescription('There are currently no live matches in your supported leagues.')
                    .setFooter({ text: 'Check back during match hours!' });
                
                return msg.edit({ embeds: [noLiveEmbed] });
            }

            const liveEmbed = new EmbedBuilder()
                .setColor(0x2ECC71) // Green for Live
                .setTitle('<a:footballg:1486727534576930846> Live Match Center')
                .setTimestamp();

            const matchStrings = liveMatches.map(m => {
                const home = m.homeTeam.shortName || m.homeTeam.name;
                const away = m.awayTeam.shortName || m.awayTeam.name;
                const score = `${m.score.fullTime.home} - ${m.score.fullTime.away}`;
                const minute = m.status === 'PAUSED' ? 'HT' : `${m.minute}'`;
                
                return `**${m.competition.name}**\n<:red:1486799490139553914> **${home}** ${score} **${away}** (${minute})`;
            }).join('\n\n');

            liveEmbed.setDescription(matchStrings);
            liveEmbed.setFooter({ text: `Total Live Matches: ${liveMatches.length}` });

            await msg.edit({ embeds: [liveEmbed] });

        } catch (err) {
            console.error(err);
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('<a:error:1486745155775234309> API Error')
                .setDescription('Could not fetch live scores. You might be hitting the rate limit.');
            
            await msg.edit({ embeds: [errorEmbed] });
        }
    },
};