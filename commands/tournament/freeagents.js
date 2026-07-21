/**
 * freeagents.js
 *
 * List all free agents (players without a team) in the server.
 * Shows name and Discord mention, sorted alphabetically.
 *
 * Usage:  .freeagents
 * Slash:  /freeagents
 *
 * Aliases: fas, freeagentlist
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { Player } = require('../../models/Tournament');

module.exports = {
    name: 'freeagents',
    description: 'List all free agents in the server.',
    usage: '.freeagents',
    aliases: ['fas', 'freeagentlist'],
    hidden: false,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('freeagents')
        .setDescription('List all free agents in the server'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            return await runFreeAgents({
                guild: message.guild,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[freeagents] prefix error:', error);
            return message.reply('❌ Failed to list free agents.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            return await runFreeAgents({
                guild: interaction.guild,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[freeagents] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to list free agents.');
            }

            return interaction.reply({ content: '❌ Failed to list free agents.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/** Fetch and display all players without a team. */
async function runFreeAgents({ guild, reply }) {
    const players = await Player.find({
        guildId: guild.id,
        $or: [
            { teamId: null },
            { teamId: { $exists: false } },
            { teamNameSnapshot: 'FREE AGENT' }
        ]
    }).sort({ name: 1 }).lean();

    const lines = players.map((player, index) => {
        const mention = player.discordID
            ? `<@${player.discordID}>`
            : '`No Discord Linked`';

        return `${index + 1}. **${player.name}** — ${mention}`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('🕊️ FREE AGENTS')
        .setDescription(
            lines.length
                ? lines.slice(0, 50).join('\n')
                : 'No free agents found.'
        )
        .setFooter({ text: `Total free agents: ${players.length}` })
        .setTimestamp();

    return reply({ embeds: [embed] });
}
