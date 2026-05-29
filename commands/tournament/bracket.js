const {
    SlashCommandBuilder
} = require('discord.js');

const { generateBracketEmbed } = require('./sendbracket');

module.exports = {
    name: 'bracket',
    description: 'View tournament knockout bracket.',
    usage: '.bracket [tournamentKey]',
    aliases: ['viewbracket', 'ko'],

    data: new SlashCommandBuilder()
        .setName('bracket')
        .setDescription('View tournament bracket')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            const key = args[0]?.toLowerCase() || null;
            const embed = await generateBracketEmbed(message.guild.id, key);
            return message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('bracket prefix error:', error);
            return message.reply('❌ Failed to load bracket.');
        }
    },

    async slashExecute(interaction) {
        try {
            const key = interaction.options.getString('key')?.toLowerCase() || null;
            const embed = await generateBracketEmbed(interaction.guild.id, key);
            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('bracket slash error:', error);
            return interaction.reply({
                content: '❌ Failed to load bracket.',
                ephemeral: true
            });
        }
    }
};