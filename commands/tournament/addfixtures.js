/**
 * addfixtures.js
 *
 * RETIRED — Legacy bulk fixture command.
 * Use /autofixtures or /generatestage instead.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'addfixtures',
    description: 'Legacy command retired. Use /autofixtures or /generatestage instead.',
    hidden: true,
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('addfixtures')
        .setDescription('Legacy command retired. Use /autofixtures or /generatestage instead.'),

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
            '**/addfixtures** is no longer used.\n\n' +
            'Use the new fixture generation commands instead:\n\n' +
            '**Automatic fixture generation**\n' +
            '`/autofixtures <tournamentKey>`\n\n' +
            '**Stage-based generation**\n' +
            '`/generatestage stage:league` — League round-robin\n' +
            '`/generatestage stage:group` — Group stage\n' +
            '`/generatestage stage:knockout` — Knockout brackets\n\n' +
            '**Manual single fixture**\n' +
            '`/forcefixture`'
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
