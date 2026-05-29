const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');

const tableCache = new Map();

module.exports = {
    name: 'standings',
    aliases: ['table', 'st'],
    category: 'utilities',
    description: 'View league standings for all major competitions',
    async execute(message) {
        const headers = { 'X-Auth-Token': process.env.FOOTBALL_API_KEY };
        
        const leagues = [
            { label: 'Champions League', value: 'CL', emoji: '<:ChampionsLeague:1486725470115332227>' },
            { label: 'Premier League', value: 'PL', emoji: '<:PremierLeague:1486725249897861160>' },
            { label: 'La Liga', value: 'PD', emoji: '<:LALIGA:1486723548256010425>' },
            { label: 'Bundesliga', value: 'BL1', emoji: '<:Bundesliga:1486725517192466602>' },
            { label: 'Serie A', value: 'SA', emoji: '<:serieA:1486725319149752350>' },
            { label: 'Ligue 1', value: 'FL1', emoji: '<:Ligue1:1486726067988467712>' },
            { label: 'Eredivisie', value: 'DED', emoji: '<:Eredivisie:1486726142093430914>' },
            { label: 'Primeira Liga', value: 'PPL', emoji: '🇵🇹' },
            { label: 'Championship', value: 'ELC', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
            { label: 'Série A (Brazil)', value: 'BSA', emoji: '🇧🇷' },
            { label: 'Euro Championship', value: 'EC', emoji: '🇪🇺' },
            { label: 'World Cup', value: 'WC', emoji: '🏆' }
        ];

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select-table')
                .setPlaceholder('📊 Choose a Competition')
                .addOptions(leagues)
        );

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('view-full').setLabel('View Full Table').setStyle(ButtonStyle.Primary).setEmoji('📜'),
            new ButtonBuilder().setCustomId('quit-st').setLabel('Quit').setStyle(ButtonStyle.Danger)
        );

        const mainEmbed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('<:stats:1486744163641725068> Football Standings Center')
            .setDescription('Select a league below to see the live standings. Data is updated every 30 minutes.');

        const msg = await message.reply({ embeds: [mainEmbed], components: [row, controlRow] });

        const collector = msg.createMessageComponentCollector({ 
            filter: i => i.user.id === message.author.id,
            idle: 90000 
        });

        let currentLeague = null;

        collector.on('collect', async i => {
            if (i.customId === 'quit-st') return collector.stop('user_quit');
            
            await i.deferUpdate();

            if (i.customId === 'select-table') currentLeague = i.values[0];
            if (!currentLeague) return;

            const leagueCode = currentLeague;
            const now = Date.now();
            let tableData;

            if (tableCache.has(leagueCode) && (now - tableCache.get(leagueCode).timestamp < 1800000)) {
                tableData = tableCache.get(leagueCode).data;
            } else {
                try {
                    const res = await axios.get(`https://api.football-data.org/v4/competitions/${leagueCode}/standings`, { headers });
                    const standingsSource = res.data.standings[0]?.table || [];
                    
                    tableData = {
                        name: res.data.competition.name,
                        fullTable: standingsSource
                    };
                    tableCache.set(leagueCode, { data: tableData, timestamp: now });
                } catch (e) {
                    return i.followUp({ content: "⚠️ API Busy. Try again in a moment.", ephemeral: true });
                }
            }

            const isFull = i.customId === 'view-full';
            const rowsToShow = isFull ? tableData.fullTable : tableData.fullTable.slice(0, 10);

            // 🏁 TABLE CONSTRUCTION
            // We check if "form" exists in any row. If not, we remove the column.
            const hasForm = tableData.fullTable.some(row => row.form !== null && row.form !== undefined);
            
            let tableBody = isFull 
                ? `POS TEAM         P  W  D  L  GD PTS${hasForm ? ' FORM' : ''}\n` 
                : "POS TEAM          P   GD  PTS\n";
            tableBody += "------------------------------------------\n";

            rowsToShow.forEach(t => {
                const pos = String(t.position).padEnd(3, ' ');
                const name = (t.team.shortName || t.team.name).substring(0, 12).padEnd(13, ' ');
                const p = String(t.playedGames).padEnd(2, ' ');
                const gd = String(t.goalDifference).padEnd(3, ' ');
                const pts = String(t.points).padEnd(3, ' ');
                
                if (isFull) {
                    const w = String(t.won).padEnd(2, ' ');
                    const d = String(t.draw).padEnd(2, ' ');
                    const l = String(t.lost).padEnd(2, ' ');
                    const formStr = hasForm ? ` ${(t.form || '-----').replace(/,/g, '')}` : '';
                    tableBody += `${pos} ${name} ${p} ${w} ${d} ${l} ${gd} ${pts}${formStr}\n`;
                } else {
                    tableBody += `${pos} ${name}  ${p}  ${gd} ${pts}\n`;
                }
            });

            const tableEmbed = new EmbedBuilder()
                .setColor(0xFEBE10)
                .setTitle(`<:stats:1486744163641725068> ${tableData.name} ${isFull ? 'Full Standings' : 'Top 10'}`)
                .setDescription(`\`\`\`\n${tableBody}\n\`\`\``)
                .setTimestamp();

            try {
                const scorerRes = await axios.get(`https://api.football-data.org/v4/competitions/${leagueCode}/scorers`, { headers });
                const scorerText = scorerRes.data.scorers.slice(0, 5).map((s, idx) => 
                    `**${idx + 1}.** ${s.player.name} (${s.team.name}) - **${s.goals}** ⚽`
                ).join('\n');
                tableEmbed.addFields({ name: '<a:footballg:1486727534576930846> Top Scorers', value: scorerText || 'No data' });
            } catch (e) { /* silent fail for scorers */ }

            await msg.edit({ embeds: [tableEmbed] });
        });

        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => null);
        });
    }
};