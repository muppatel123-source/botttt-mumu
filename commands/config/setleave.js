const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'setleave',
    description: 'Sets the channel for leave messages.',
    usage: '<#channel>',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setleave')
        .setDescription('Sets channel for leave messages.')
        .addChannelOption(opt => opt.setName('channel').setDescription('Select channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),

    async execute(message, args) {
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel) return message.reply("❓ Mention a channel.");
        message.client.greetings.set(message.guild.id, channel.id, "leaveChannel");
        message.reply(`✅ Leave messages set to ${channel}`);
    },

    async slashExecute(interaction) {
        const channel = interaction.options.getChannel('channel');
        interaction.client.greetings.set(interaction.guild.id, channel.id, "leaveChannel");
        
        const preview = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle("🚪 Farewell Configured")
            .setDescription(`Leave logs will now be sent to ${channel}.\n\n*Make sure I have permission to send embeds there!*`);
            
        interaction.reply({ embeds: [preview] });
    }
};