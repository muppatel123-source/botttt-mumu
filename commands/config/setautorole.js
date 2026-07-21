const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'setautorole',
    description: 'Sets the role given to users when they join.',
    usage: '<@role/ID>',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setautorole')
        .setDescription('Sets the role given to new members.')
        .addRoleOption(opt => opt.setName('role').setDescription('Select the role (Leave empty to disable)')),

    async execute(message, args) {
        if (args[0] === 'none') {
            message.client.greetings.delete(message.guild.id, "autoRole");
            return message.reply("✅ Auto-role disabled.");
        }
        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
        if (!role) return message.reply("❓ Mention a role.");
        message.client.greetings.set(message.guild.id, role.id, "autoRole");
        message.reply(`✅ Auto-role set to **${role.name}**.`);
    },

    async slashExecute(interaction) {
        const role = interaction.options.getRole('role');
        if (!role) {
            interaction.client.greetings.delete(interaction.guild.id, "autoRole");
            return interaction.reply("✅ Auto-role disabled.");
        }
        interaction.client.greetings.set(interaction.guild.id, role.id, "autoRole");
        interaction.reply(`✅ New members will get **${role.name}**.`);
    }
};