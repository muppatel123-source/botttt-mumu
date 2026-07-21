const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    name: 'setwelcome',
    description: 'Sets the channel for welcome messages.',
    usage: '<#channel>',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setwelcome')
        .setDescription('Sets the channel for welcome messages.')
        .addChannelOption(opt => opt.setName('channel').setDescription('Select channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),

    async execute(message, args) {
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel) return message.reply("❓ Mention a channel.");
        message.client.greetings.set(message.guild.id, channel.id, "welcomeChannel");
        message.reply(`✅ Welcome messages set to ${channel}`);
    },

    async slashExecute(interaction) {
        const channel = interaction.options.getChannel('channel');
        interaction.client.greetings.set(interaction.guild.id, channel.id, "welcomeChannel");
        interaction.reply(`✅ Welcome messages set to ${channel}`);
    }
};