const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'postlineup',
    category: 'football',
    hidden: true, // Hides from your custom .help menu
    description: 'Broadcast match lineups to all alert channels. (Owner only)',
    
    data: new SlashCommandBuilder()
        .setName('postlineup')
        .setDescription('Broadcast match lineups (Owner only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Only Admins see it in the / list
        .addStringOption(opt => opt.setName('league').setDescription('League code (PD, CL, etc.)').setRequired(true))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Upload lineup graphic').setRequired(true))
        .addStringOption(opt => opt.setName('match').setDescription('Match details')),

    async execute(message, args) {
        // --- 🛡️ GATEKEEPER ---
        if (message.author.id !== process.env.OWNER_ID) return; 

        const leagueCode = args[0]?.toUpperCase();
        const attachment = message.attachments.first();
        const matchInfo = args.slice(1).join(' ') || "Upcoming Match";

        if (!leagueCode || !attachment) return message.reply("❓ `.postlineup <LeagueCode> (attach image)`");
        await this.broadcast(message, leagueCode, attachment.proxyURL || attachment.url, matchInfo, false);
    },

    async slashExecute(interaction) {
        // --- 🛡️ GATEKEEPER ---
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: "❌ This is a restricted owner command.", ephemeral: true });
        }

        const leagueCode = interaction.options.getString('league').toUpperCase();
        const attachment = interaction.options.getAttachment('image');
        const matchInfo = interaction.options.getString('match') || "Upcoming Match";

        await this.broadcast(interaction, leagueCode, attachment.proxyURL || attachment.url, matchInfo, true);
    },

    async broadcast(input, league, imageUrl, info, isSlash) {
        const liveConfigs = input.client.liveSettings;
        let count = 0;

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`<:notessssss:1486742759606976644> Lineups Confirmed!`)
            .setDescription(`<a:footballg:1486727534576930846> **${info}**\nLeague: \`${league}\``)
            .setImage(imageUrl)
            .setTimestamp();

        for (const serverData of liveConfigs.values()) {
            if (serverData.leagues?.includes(league)) {
                const channel = input.client.channels.cache.get(serverData.channelId);
                if (channel) {
                    try { await channel.send({ embeds: [embed] }); count++; } catch (err) {}
                }
            }
        }

        const reply = `✅ Broadcasted to **${count}** channels for **${league}**.`;
        return isSlash ? input.reply({ content: reply, ephemeral: true }) : input.reply(reply);
    }
};