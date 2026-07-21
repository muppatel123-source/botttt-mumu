/**
 * addplayed.js
 *
 * RETIRED — Legacy manual played count command.
 * Stats are now tracked automatically via /report and /addstats.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'addplayed',
    description: 'Legacy command retired. Stats are tracked automatically.',
    hidden: true,
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('addplayed')
        .setDescription('Legacy command retired. Stats are tracked automatically.'),

    async execute(message) {
        return sendRetiredMessage({
            reply: payload => message.reply(payload)
        });
    },

    async slashExecute(interaction) {
        return sendRetiredMessage({
            reply: payload => interaction.reply({ ...payload, ephemeral: true })
        });
    }
};

/**
 * Send the retirement notice with alternatives.
 */
function sendRetiredMessage({ reply }) {
    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('♻️ LEGACY COMMAND RETIRED')
        .setDescription(
            '**/addplayed** is no longer used.\n\n' +
            'Match played counts are tracked automatically through:\n\n' +
            '• **`/report`** — Reports a fixture result (auto-increments played)\n' +
            '• **`/addstats`** — Bulk stat input (optional `+1 played` per row)\n\n' +
            'If you need to fix incorrect stats, use:\n' +
            '• **`/removestats`** — Remove stats from a player\n' +
            '• **`/resetstats`** — Reset a team/player\'s tournament stats'
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
