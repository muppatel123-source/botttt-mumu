const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'viewalerts',
    aliases: ['va', 'alertsinfo', 'checkalerts'],
    description: 'View the active goal alert settings for this server.',
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('viewalerts')
        .setDescription('View the active goal alert settings for this server.'),

    async execute(message) {
        await this.runLogic(message, false);
    },

    async slashExecute(interaction) {
        await this.runLogic(interaction, true);
    },

    async runLogic(input, isSlash) {
        const settings = input.client.liveSettings.get(input.guild.id);

        if (!settings || !settings.channelId) {
            const noSettingsMsg = "❌ **No alerts configured.** Use `.setalerts` to get started!";
            return isSlash ? input.reply({ content: noSettingsMsg, ephemeral: true }) : input.reply(noSettingsMsg);
        }

        // Mapping for clean display names and emojis
        const leagueMap = {
            'PD': { name: 'La Liga', emoji: '<:LALIGA:1486723548256010425>' },
            'CL': { name: 'Champions League', emoji: '<:ChampionsLeague:1486725470115332227>' },
            'PL': { name: 'Premier League', emoji: '<:PremierLeague:1486725249897861160>' },
            'SA': { name: 'Serie A', emoji: '<:serieA:1486725319149752350>' },
            'BL1': { name: 'Bundesliga', emoji: '<:Bundesliga:1486725517192466602>' },
            'FL1': { name: 'Ligue 1', emoji: '<:Ligue1:1486726067988467712>' },
            'DED': { name: 'Eredivisie', emoji: '<:Eredivisie:1486726142093430914>' },
            'PPL': { name: 'Primeira Liga', emoji: '🇵🇹' },
            'ELC': { name: 'Championship', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
            'BSA': { name: 'Serie A (Brazil)', emoji: '🇧🇷' },
            'CLI': { name: 'Copa Libertadores', emoji: '🌎' },
            'EC': { name: 'Euro 2024', emoji: '🇪🇺' }
        };

        const channelMention = `<#${settings.channelId}>`;
        const leagueList = settings.leagues.map(code => {
            const league = leagueMap[code] || { name: code, emoji: '⚽' };
            return `${league.emoji} **${league.name}** (\`${code}\`)`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('<:Info:1486732443888259154> Active Goal Alerts')
            .setThumbnail(input.guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '📍 Broadcast Channel', value: `> ${channelMention}`, inline: false },
                { name: '🏟️ Tracked Leagues', value: leagueList || 'None', inline: false }
            )
            .setFooter({ text: `Server: ${input.guild.name}` })
            .setTimestamp();

        return isSlash ? input.reply({ embeds: [embed] }) : input.reply({ embeds: [embed] });
    }
};