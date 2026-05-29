const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    name: 'setboost',
    description: 'Sets the channel for boost messages.',
    usage: '<#channel>',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setboost')
        .setDescription('Sets boost message channel.')
        .addChannelOption(opt => opt.setName('channel').setDescription('Select channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),

    async execute(message, args) {
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel) return message.reply("❓ Mention a channel.");
        message.client.greetings.set(message.guild.id, channel.id, "boostChannel");
        message.reply(`✅ Boost messages set to ${channel}`);
    },

    async slashExecute(interaction) {
        const channel = interaction.options.getChannel('channel');
        interaction.client.greetings.set(interaction.guild.id, channel.id, "boostChannel");
        interaction.reply(`✅ Boost messages set to ${channel}`);
    }
};