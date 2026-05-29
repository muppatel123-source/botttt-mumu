const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const globalCache = { leagues: new Map(), teamFixtures: new Map() };

module.exports = {
    name: 'matches',
    category: 'utilities',
    description: 'Pro Match Center for all 12 supported leagues',
    async execute(message) {
        const API_TOKEN = process.env.FOOTBALL_API_KEY;
        const BASE_URL = 'https://api.football-data.org/v4';
        const headers = { 'X-Auth-Token': API_TOKEN };

        const leagues = [
            { label: 'La Liga', value: 'PD', emoji: '<:LALIGA:1486723548256010425>' },
            { label: 'Champions League', value: 'CL', emoji: '<:ChampionsLeague:1486725470115332227>' },
            { label: 'Premier League', value: 'PL', emoji: '<:PremierLeague:1486725249897861160>' },
            { label: 'Serie A', value: 'SA', emoji: '<:serieA:1486725319149752350>' },
            { label: 'Bundesliga', value: 'BL1', emoji: '<:Bundesliga:1486725517192466602>' },
            { label: 'Ligue 1', value: 'FL1', emoji: '<:Ligue1:1486726067988467712>' },
            { label: 'Eredivisie', value: 'DED', emoji: '<:Eredivisie:1486726142093430914>' },
            { label: 'Primeira Liga', value: 'PPL', emoji: '🇵🇹' },
            { label: 'Championship', value: 'ELC', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
            { label: 'Serie A (Brazil)', value: 'BSA', emoji: '🇧🇷' },
            { label: 'Copa Libertadores', value: 'CLI', emoji: '🌎' },
            { label: 'Euro Championship', value: 'EC', emoji: '🇪🇺' }
        ];

        const leagueRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select-league')
                .setPlaceholder('🌍 Choose a League')
                .addOptions(leagues)
        );

        const quitRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('quit-match').setLabel('Quit').setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('<a:footballg:1486727534576930846> Match Center')
            .setDescription('Select a league to see fixtures or specific team schedules.')
           // .setFooter({ text: `Total Commands: ${message.client.commands.size}` });

        const msg = await message.reply({ embeds: [embed], components: [leagueRow, quitRow] });

        const collector = msg.createMessageComponentCollector({ 
            filter: i => i.user.id === message.author.id,
            idle: 60000 
        });

        collector.on('collect', async i => {
            if (i.customId === 'quit-match') return collector.stop('user_quit');

            await i.deferUpdate();

            if (i.customId === 'select-league') {
                const leagueCode = i.values[0];
                try {
                    const [mRes, tRes] = await Promise.all([
                        axios.get(`${BASE_URL}/competitions/${leagueCode}/matches?status=SCHEDULED`, { headers }),
                        axios.get(`${BASE_URL}/competitions/${leagueCode}/teams`, { headers })
                    ]);

                    const matches = mRes.data.matches.slice(0, 8);
                    const teams = tRes.data.teams.slice(0, 25);

                    const teamRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select-team')
                            .setPlaceholder('🔍 Filter by Team')
                            .addOptions(teams.map(t => ({ label: t.name, value: String(t.id) })))
                    );

                    const fixtureList = matches.map(m => `**${m.homeTeam.name}** vs **${m.awayTeam.name}**\n<:Calender:1486728196475846656> <t:${Math.floor(new Date(m.utcDate).getTime() / 1000)}:f>`).join('\n\n');

                    const leagueEmbed = new EmbedBuilder()
                        .setColor(0xFEBE10)
                        .setTitle(`<:Calender:1486728196475846656> Upcoming: ${leagues.find(l => l.value === leagueCode).label}`)
                        .setDescription(fixtureList || "No matches scheduled.")
                        .setFooter({ text: "Select a team below for their specific schedule." });

                    await i.editReply({ embeds: [leagueEmbed], components: [leagueRow, teamRow, quitRow] });
                } catch (e) {
                    await i.followUp({ content: "<a:CAUTION:1486728415015993477> API Busy! Please wait 1 minute.", ephemeral: true });
                }
            }

            if (i.customId === 'select-team') {
                const teamId = i.values[0];
                try {
                    const res = await axios.get(`${BASE_URL}/teams/${teamId}/matches?status=SCHEDULED`, { headers });
                    const teamMatches = res.data.matches.slice(0, 5);
                    const teamName = teamMatches.length > 0 ? (teamMatches[0].homeTeam.id == teamId ? teamMatches[0].homeTeam.name : teamMatches[0].awayTeam.name) : "Team";
                    
                    const teamEmbed = new EmbedBuilder()
                        .setColor(0xFEBE10)
                        .setTitle(`<:Calender:1486728196475846656> Next 5 Matches: ${teamName}`)
                        .setDescription(teamMatches.length > 0 ? teamMatches.map(m => `<a:footballg:1486727534576930846> **${m.homeTeam.name}** vs **${m.awayTeam.name}**\n<:trophyss:1486730660931436555> ${m.competition.name}\n<:Calender:1486728196475846656> <t:${Math.floor(new Date(m.utcDate).getTime() / 1000)}:R>`).join('\n\n') : "No upcoming matches found.")
                        .setFooter({ text: "Live Data Feed" });

                    await i.editReply({ embeds: [teamEmbed] });
                } catch (e) {
                    await i.followUp({ content: "<a:Cross_:1486728686005649650> Error fetching team data.", ephemeral: true });
                }
            }
        });

        collector.on('end', (_, reason) => {
            msg.edit({ components: [] }).catch(() => null);
        });
    },
};