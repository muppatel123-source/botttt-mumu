const { EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'player',
    aliases: ['bio', 'scout', 'athlete'],
    category: 'football, cricket',
    description: 'Get an athlete profile for any sport (Football, F1, Cricket, etc).',
    async execute(message, args) {
        if (!args.length) return message.reply("❌ Give me a name! (e.g., `.player Verstappen` or `.player Kohli`)");

        const playerName = args.join('_');
        const apiKey = process.env.SPORTSDB_API_KEY || '3';

        const cleanName = (name) => {
            if (!name) return 'N/A';
            return name.replace(/_/g, ' ').replace(/Soccer/gi, '').trim();
        };

        try {
            const res = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/searchplayers.php?p=${playerName}`);

            if (!res.data.player || res.data.player.length === 0) {
                return message.reply(`❌ No data found for "**${args.join(' ')}**".`);
            }

            const p = res.data.player[0];
            
            // --- SMART STATUS & SPORT DETECTION ---
            let status = "Active";
            let description = "";
            let rawClub = p.strTeam || 'N/A';
            let clubDisplay = cleanName(rawClub);
            const sport = p.strSport || 'Sport';

            if (rawClub.includes('_Deceased')) {
                status = "🕊️ Legend (Deceased)";
                clubDisplay = "Historical";
                description = `**${p.strPlayer}** is a legendary **${sport}** icon remembered for their incredible impact on the game.`;
            } 
            else if (rawClub.includes('_Retired') || rawClub.includes('Retired')) {
                status = "👟 Retired";
                clubDisplay = "Career Ended";
                description = `**${p.strPlayer}** has retired after a legendary career in professional **${sport}**.`;
            }
            else if (p.strPosition === 'Manager') {
                status = "👔 Manager";
                description = `**${p.strPlayer}** is currently leading **${clubDisplay}** as a Manager.`;
            } 
            else {
                // Dynamic description based on the sport
                description = `Official profile for **${p.strPlayer}**, currently a **${p.strPosition}** for **${clubDisplay}** (${sport}).`;
            }

            const embed = new EmbedBuilder()
                .setColor(0xFEBE10)
                .setTitle(`${p.strPlayer} (${p.strNumber || 'N/A'})`)
                .setThumbnail(p.strThumb)
                .setDescription(description)
                .addFields(
                    { name: '🏟️ Team/Club', value: clubDisplay, inline: true },
                    { name: '🌍 Nation', value: p.strNationality || 'N/A', inline: true },
                    { name: '📍 Position', value: p.strPosition || 'N/A', inline: true },
                    { name: '🎂 Birthday', value: p.dateBorn || 'N/A', inline: true },
                    { name: '📈 Status', value: status, inline: true },
                    { name: '🚻 Gender', value: p.strGender || 'N/A', inline: true }
                )
                // 🎯 FOOTER UPDATE: Informing users of multi-sport support
                .setFooter({ text: 'Supports Football, F1, Cricket, Cycling & more! • TheSportDB' })
                .setTimestamp();

            // Add Socials
            let socials = [];
            if (p.strInstagram) socials.push(`[Instagram](https://${p.strInstagram})`);
            if (p.strTwitter) socials.push(`[Twitter](https://${p.strTwitter})`);
            
            if (socials.length > 0) {
                embed.addFields({ name: '🔗 Socials', value: socials.join(' | '), inline: false });
            }

            message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            message.reply("❌ Error connecting to the sports database.");
        }
    },
};