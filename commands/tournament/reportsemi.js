/**
 * reportsemi.js
 *
 * Legacy command retired. Use /report instead.
 *
 * Aliases: semireport
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    name: 'reportsemi',
    description: 'Legacy command retired. Use /report instead.',
    hidden: true,
    cooldown: 3,
    aliases: ['semireport'],

    data: new SlashCommandBuilder()
        .setName('reportsemi')
        .setDescription('Legacy command retired. Use /report instead.'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        return sendRetiredMessage({
            reply: payload => message.reply(payload),
            commandName: 'reportsemi'
        });
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        return sendRetiredMessage({
            reply: payload => interaction.reply({ ...payload, ephemeral: true }),
            commandName: 'reportsemi'
        });
    }
};

/* ====================================================
   RETIRED MESSAGE
==================================================== */

function sendRetiredMessage({ reply, commandName }) {
    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('♻️ LEGACY COMMAND RETIRED')
        .setDescription(
            `**/${commandName}** is no longer used.\n\n` +
            `Use the unified knockout-safe flow instead:\n\n` +
            `**1. Report the match**\n` +
            `\`/report team1:<name> score1:<n> team2:<name> score2:<n>\`\n` +
            `Optional:\n` +
            `• \`et1\` + \`et2\`\n` +
            `• \`pen1\` + \`pen2\`\n\n` +
            `**2. Advance the bracket**\n` +
            `\`/advanceknockout current_round:semifinal\`\n\n` +
            `**3. View bracket**\n` +
            `\`/bracket\``
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
