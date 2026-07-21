const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'setboostrole',
    description: 'Sets an extra role given to members when they boost.',
    usage: '<@role/ID>',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setboostrole')
        .setDescription('Sets role given when someone boosts.')
        .addRoleOption(opt => opt.setName('role').setDescription('Select role (Leave empty to disable)')),

    async execute(message, args) {
        if (args[0] === 'none') {
            message.client.greetings.delete(message.guild.id, "boostRole");
            return message.reply("✅ Boost role disabled.");
        }
        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
        if (!role) return message.reply("❓ Mention a role.");
        message.client.greetings.set(message.guild.id, role.id, "boostRole");
        message.reply(`✅ Boosters will get **${role.name}**.`);
    },

    async slashExecute(interaction) {
        const role = interaction.options.getRole('role');
        if (!role) {
            interaction.client.greetings.delete(interaction.guild.id, "boostRole");
            return interaction.reply("✅ Boost role disabled.");
        }
        interaction.client.greetings.set(interaction.guild.id, role.id, "boostRole");
        interaction.reply(`✅ Boosters will now receive **${role.name}**.`);
    }
};