const { EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'stadium',
    description: 'Get info and a beautiful picture of a team\'s home stadium.',
    async execute(message, args) {
        if (!args.length) return message.reply("❌ Name a team! (e.g., `.stadium PSG`) ");

        const apiKey = process.env.SPORTSDB_API_KEY || '3';
        let searchTerm = args.join('_');

        // 🎯 THE TRICK: If someone searches PSG, we force it to the main club name
        if (searchTerm.toLowerCase() === 'psg') searchTerm = 'Paris_Saint-Germain';

        try {
            const res = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/searchteams.php?t=${encodeURIComponent(searchTerm)}`);

            if (!res.data || !res.data.teams) {
                return message.reply(`❌ Team not found for "**${args.join(' ')}**".`);
            }

            // Filter for Soccer and Sort by Capacity to ensure the biggest stadium wins
            const sortedTeams = res.data.teams
                .filter(team => team.strSport.toLowerCase() === 'soccer' && !team.strTeam.toLowerCase().includes('academy'))
                .sort((a, b) => parseInt(b.intStadiumCapacity) - parseInt(a.intStadiumCapacity));

            const t = sortedTeams[0] || res.data.teams[0];

            const embed = new EmbedBuilder()
                .setColor(0x004170)
                .setTitle(`🏟️ ${t.strStadium}`)
                .setDescription(`The proud home of **${t.strTeam}** in **${t.strLocation}**.`)
                .setThumbnail(t.strBadge)
                .setImage(t.strStadiumThumb)
                .addFields(
                    { name: '👥 Capacity', value: `${parseInt(t.intStadiumCapacity).toLocaleString()}`, inline: true },
                    { name: '📍 Location', value: t.strLocation, inline: true }
                )
                .setFooter({ text: `Source: TheSportsDB | Exact Match Logic Active` })
                .setTimestamp();

            message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            message.reply("❌ Error fetching stadium data.");
        }
    },
};