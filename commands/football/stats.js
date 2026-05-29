const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = {
    name: 'stats',
    description: 'Ultra-pro paginated player scouting report.',
    async execute(message, args) {
        const playerName = args.join(" ");
        if (!playerName) return message.reply("⚽ **Enter a player name!**");

        const waitMsg = await message.reply(`🔍 **Scouting ${playerName}...**`);

        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                tools: [{ googleSearch: {} }] 
            });

            const prompt = `Today is March 31, 2026. Search for current 2025/26 and career stats for "${playerName}".
            Return ONLY raw JSON: {
                "name": "", "club": "", "league": "", "nation": "", "pos": "Forward/Midfielder/Defender/Goalkeeper", "foot": "",
                "lgG": "0", "lgA": "0", "uclG": "0", "uclA": "0", "carG": "0", "carA": "0", "intG": "0", "intA": "0", "yc": "0", "rc": "0",
                "shooting": { "xG": "0.0", "xGOT": "0.0", "shots": "0", "sot": "0" },
                "passing": { "xA": "0.0", "passAcc": "0%", "longAcc": "0%", "chances": "0" },
                "defending": { "tackles": "0", "inter": "0", "recov": "0", "cleans": "0", "conceded": "0" },
                "gk": { "saves": "0", "saveP": "0%", "prevented": "0", "penSaves": "0" }
            }`;

            const result = await model.generateContent(prompt);
            const p = JSON.parse(result.response.text().match(/\{[\s\S]*\}/)[0]);

            // 📸 MONGODB FUZZY IMAGE SEARCH
            let playerImage = 'https://i.imgur.com/8E9v6I6.png';
            const dbPlayer = await message.client.db.players.findOne({ name: { $regex: new RegExp(p.name.split(' ').pop(), 'i') } });
            if (dbPlayer?.imageURL) playerImage = dbPlayer.imageURL;

            const isGK = p.pos.toLowerCase().includes('goalkeeper');

            // --- PAGE GENERATORS ---
            const createMainEmbed = () => new EmbedBuilder()
                .setColor(0xFEBE10).setTitle(`💎 SCOUTING: ${p.name.toUpperCase()}`).setThumbnail(playerImage)
                .setDescription(`**${p.club}** | ${p.nation}\n\`\`\`ansi\n\u001b[1;34mLeague:\u001b[0m ${p.league}\n\u001b[1;34mFoot:\u001b[0m ${p.foot}\`\`\``)
                .addFields(
                    { name: '🏆 LA LIGA', value: `⚽ **G:** ${p.lgG} | 🎯 **A:** ${p.lgA}`, inline: true },
                    { name: '🇪🇺 UCL', value: `⚽ **G:** ${p.uclG} | 🎯 **A:** ${p.uclA}`, inline: true },
                    { name: '📈 CAREER', value: `⚽ **G:** ${p.carG} | 🎯 **A:** ${p.carA}`, inline: false }
                );

            const createDetailEmbed = (type) => {
                const e = new EmbedBuilder().setColor(0xFEBE10).setTitle(`📑 ${type.toUpperCase()} ANALYSIS: ${p.name}`);
                if (type === 'attacking') e.addFields(
                    { name: '🎯 Shooting', value: `Goals: **${p.lgG}**\nxG: **${p.shooting.xG}**\nxGOT: **${p.shooting.xGOT}**\nShots: **${p.shooting.shots}**\nOn Target: **${p.shooting.sot}**` },
                    { name: '🟨 Discipline', value: `Yellow: ${p.yc} | Red: ${p.rc}` }
                );
                if (type === 'passing') e.addFields({ name: '📂 Creation', value: `Assists: **${p.lgA}**\nxA: **${p.passing.xA}**\nPass Accuracy: **${p.passing.passAcc}**\nLong Ball Acc: **${p.passing.longAcc}**\nChances Created: **${p.passing.chances}**` });
                if (type === 'defending') e.addFields({ name: '🛡️ Defense', value: `Tackles: **${p.defending.tackles}**\nInterceptions: **${p.defending.inter}**\nRecoveries: **${p.defending.recov}**\nClean Sheets: **${p.defending.cleans}**\nGoals Conceded: **${p.defending.conceded}**` });
                if (type === 'gk') e.addFields({ name: '🧤 Goalkeeping', value: `Saves: **${p.gk.saves}**\nSave %: **${p.gk.saveP}**\nGoals Prevented: **${p.gk.prevented}**\nPenalty Saves: **${p.gk.penSaves}**\nClean Sheets: **${p.defending.cleans}**` });
                return e;
            };

            // --- BUTTONS ---
            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('home').setEmoji('🏠').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('page1').setEmoji(isGK ? '🧤' : '🎯').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('page2').setEmoji('📂').setStyle(ButtonStyle.Secondary).setDisabled(isGK),
                new ButtonBuilder().setCustomId('page3').setEmoji('🛡️').setStyle(ButtonStyle.Secondary).setDisabled(isGK)
            );

            const response = await waitMsg.edit({ content: null, embeds: [createMainEmbed()], components: [buttons] });
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) return i.reply({ content: "Scout only!", ephemeral: true });
                await i.deferUpdate();
                if (i.customId === 'home') await response.edit({ embeds: [createMainEmbed()] });
                if (i.customId === 'page1') await response.edit({ embeds: [createDetailEmbed(isGK ? 'gk' : 'attacking')] });
                if (i.customId === 'page2') await response.edit({ embeds: [createDetailEmbed('passing')] });
                if (i.customId === 'page3') await response.edit({ embeds: [createDetailEmbed('defending')] });
            });

        } catch (error) {
            console.error(error);
            return waitMsg.edit("❌ **Error.** Model busy or player not found.");
        }
    },
};