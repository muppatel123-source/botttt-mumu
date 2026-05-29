const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    name: 'reportfinal',
    description: 'Legacy command retired. Use /report instead.',
    hidden: true,
    aliases: ['finalreport'],

    data: new SlashCommandBuilder()
        .setName('reportfinal')
        .setDescription('Legacy command retired. Use /report instead.'),

    async execute(message) {
        return sendRetiredMessage({
            reply: (payload) => message.reply(payload),
            commandName: 'reportfinal'
        });
    },

    async slashExecute(interaction) {
        return sendRetiredMessage({
            reply: (payload) => interaction.reply({ ...payload, ephemeral: true }),
            commandName: 'reportfinal'
        });
    }
};

function sendRetiredMessage({
    reply,
    commandName
}) {
    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('♻️ LEGACY COMMAND RETIRED')
        .setDescription(
            `**/${commandName}** is no longer used.\n\n` +
            `Use the unified final-reporting flow instead:\n\n` +
            `**1. Report the final**\n` +
            `\`/report team1:<name> score1:<n> team2:<name> score2:<n>\`\n` +
            `Optional:\n` +
            `• \`et1\` + \`et2\`\n` +
            `• \`pen1\` + \`pen2\`\n\n` +
            `**2. View final bracket state**\n` +
            `\`/bracket\`\n\n` +
            `If this is the last match, you do not need a separate legacy final command anymore.`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}