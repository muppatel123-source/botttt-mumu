const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'socials',
    aliases: ['links', 'hub'],
    description: 'Get a professional social media dashboard for any team.',
    async execute(message, args) {
        if (!args.length) return message.reply("❌ Which team? (e.g., `.socials Real Madrid`) ");

        const apiKey = process.env.SPORTSDB_API_KEY || '3';

        try {
            const res = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/searchteams.php?t=${encodeURIComponent(args.join('_'))}`);
            
            if (!res.data.teams || res.data.teams.length === 0) {
                return message.reply("❌ Team not found in the database!");
            }
            
            const t = res.data.teams[0];

            // --- UI ROW 1: PRIMARY SOCIALS ---
            const row1 = new ActionRowBuilder();
            if (t.strInstagram) {
                row1.addComponents(new ButtonBuilder()
                    .setLabel('Instagram')
                    .setEmoji('📸')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://${t.strInstagram}`));
            }
            if (t.strTwitter) {
                row1.addComponents(new ButtonBuilder()
                    .setLabel('Twitter / X')
                    .setEmoji('🚀')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://${t.strTwitter}`));
            }

            // --- UI ROW 2: OFFICIAL CHANNELS ---
            const row2 = new ActionRowBuilder();
            if (t.strFacebook) {
                row2.addComponents(new ButtonBuilder()
                    .setLabel('Facebook')
                    .setEmoji('🛡️')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://${t.strFacebook}`));
            }
            if (t.strWebsite) {
                row2.addComponents(new ButtonBuilder()
                    .setLabel('Official Website')
                    .setEmoji('💎')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://${t.strWebsite}`));
            }

            const embed = new EmbedBuilder()
                .setColor(0xFEBE10) // Gold/Yellow Accents
                .setAuthor({ name: `${t.strTeam} | Digital Presence`, iconURL: t.strBadge })
                .setTitle(`🌐 ${t.strTeam} Hub`)
                .setDescription(`Verified official channels and digital platforms for **${t.strTeam}**.`)
                // This large image makes the UI look high-end
                .setImage(t.strFanart1 || t.strStadiumThumb || null) 
                .setThumbnail(t.strBadge)
                .addFields(
                    { name: '🏟️ Home Ground', value: t.strStadium || 'N/A', inline: true },
                    { name: '🌍 Location', value: t.strLocation || 'N/A', inline: true }
                )
                .setFooter({ text: '⚡ Verified by Mumu UI • Data: TheSportsDB' })
                .setTimestamp();

            const components = [];
            if (row1.components.length > 0) components.push(row1);
            if (row2.components.length > 0) components.push(row2);
            
            message.reply({ embeds: [embed], components: components });

        } catch (error) {
            console.error(error);
            message.reply("❌ Failed to build the social dashboard. Try again later!");
        }
    },
};