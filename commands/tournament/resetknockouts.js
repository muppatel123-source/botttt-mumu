/**
 * resetknockouts.js
 *
 * Legacy command retired. Use /resettournament or the new knockout flow.
 *
 * Aliases: resetko, koreset
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    name: 'resetknockouts',
    description: 'Legacy command retired. Use /resettournament or the new knockout flow instead.',
    hidden: true,
    cooldown: 3,
    aliases: ['resetko', 'koreset'],

    data: new SlashCommandBuilder()
        .setName('resetknockouts')
        .setDescription('Legacy command retired. Use /resettournament instead.'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        return sendRetiredMessage({
            reply: payload => message.reply(payload)
        });
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        return sendRetiredMessage({
            reply: payload => interaction.reply({ ...payload, ephemeral: true })
        });
    }
};

/* ====================================================
   RETIRED MESSAGE
==================================================== */

function sendRetiredMessage({ reply }) {
    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('♻️ LEGACY COMMAND RETIRED')
        .setDescription(
            `**/resetknockouts** is no longer used.\n\n` +
            `Use the new system depending on what you actually want:\n\n` +
            `**Clear knockout fixtures only**\n` +
            `\`/resettournament mode:fixtures confirm:true\`\n\n` +
            `**Cancel an active knockout draw**\n` +
            `\`/canceldraw\`\n\n` +
            `**Regenerate knockout stage automatically**\n` +
            `\`/generatestage stage:knockout\`\n\n` +
            `**Run a manual knockout draw**\n` +
            `1. \`/startdraw stage:knockout\`\n` +
            `2. Use the public draw buttons\n` +
            `3. \`/finishdraw\`\n\n` +
            `**Advance after matches are reported**\n` +
            `\`/advanceknockout current_round:<round>\``
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
