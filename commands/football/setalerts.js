const { PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');

module.exports = {
    name: 'setalerts',
    aliases: ['setgoals', 'setmatches', 'setlive'],
    description: 'Configure specific leagues and channel for Goal Alerts',
    async execute(message, args) {
        // 1. Permission Check
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply("<a:Cross_:1486728686005649650> You need `Manage Channels` permission!");
        }

        // 2. Channel Selection
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel || !channel.isTextBased()) {
            return message.reply("<a:error:1486745155775234309> Mention a channel: `.setgoals #channel`.");
        }

        // 3. League Options
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
            { label: 'Euro 2024', value: 'EC', emoji: '🇪🇺' }
        ];

        const menu = new StringSelectMenuBuilder()
            .setCustomId('select-leagues')
            .setPlaceholder('⚽ Select leagues for alerts (Multiple allowed)')
            .setMinValues(1)
            .setMaxValues(leagues.length)
            .addOptions(leagues);

        const row = new ActionRowBuilder().addComponents(menu);

        const msg = await message.reply({ 
            content: `<:tick:1486733833419358339> Channel set to ${channel}. Now, select which leagues to track:`, 
            components: [row] 
        });

        // 4. Collector Logic
        const collector = msg.createMessageComponentCollector({ 
            componentType: ComponentType.StringSelect, 
            time: 60000 
        });

        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: 'Not yours!', ephemeral: true });

            const selectedLeagues = i.values;

            // --- ENMAP SAVING LOGIC ---
            // We save an object containing both the channel and the league list
            message.client.liveSettings.set(message.guild.id, {
                channelId: channel.id,
                leagues: selectedLeagues
            });

            await i.update({ 
                content: `<:tick:1486733833419358339> **Setup Complete!**\nChannel: ${channel}\nLeagues: ${selectedLeagues.join(', ')}`, 
                components: [] 
            });
        });
        
        collector.on('end', collected => {
            if (collected.size === 0) {
                msg.edit({ content: '❌ Setup timed out. Please try again.', components: [] }).catch(() => null);
            }
        });
    },
};