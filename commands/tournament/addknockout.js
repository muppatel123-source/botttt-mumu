const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    name: 'addknockout',
    description: 'Legacy command retired. Use /generatestage or /startdraw instead.',
    hidden: true,
    aliases: ['koadd', 'makeknockout'],

    data: new SlashCommandBuilder()
        .setName('addknockout')
        .setDescription('Legacy command retired. Use /generatestage or /startdraw instead.'),

    async execute(message) {
        return sendRetiredMessage({
            reply: (payload) => message.reply(payload)
        });
    },

    async slashExecute(interaction) {
        return sendRetiredMessage({
            reply: (payload) => interaction.reply({ ...payload, ephemeral: true })
        });
    }
};

function sendRetiredMessage({
    reply
}) {
    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('♻️ LEGACY COMMAND RETIRED')
        .setDescription(
            `**/addknockout** is no longer used.\n\n` +
            `Use the new knockout flow instead:\n\n` +
            `**Automatic knockout generation**\n` +
            `\`/generatestage stage:knockout\`\n\n` +
            `**Manual public draw flow**\n` +
            `1. \`/startdraw stage:knockout\`\n` +
            `2. Run the public draw buttons\n` +
            `3. \`/finishdraw\`\n\n` +
            `**After matches are played**\n` +
            `• \`/report\`\n` +
            `• \`/advanceknockout\`\n` +
            `• \`/bracket\``
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}