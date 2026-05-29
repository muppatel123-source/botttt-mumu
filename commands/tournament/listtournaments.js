const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer
} = require('../../models/Tournament');

module.exports = {
    name: 'listtournaments',
    description: 'View all tournaments in this server.',
    usage: '.listtournaments',
    aliases: ['tournaments', 'alltournaments', 'tourlist'],

    data: new SlashCommandBuilder()
        .setName('listtournaments')
        .setDescription('View all tournaments'),

    async execute(message) {
        try {
            return await runList({
                guild: message.guild,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('listtournaments prefix error:', error);
            return message.reply('❌ Failed to load tournaments.');
        }
    },

    async slashExecute(interaction) {
        try {
            return await runList({
                guild: interaction.guild,
                reply: payload => interaction.reply(payload)
            });
        } catch (error) {
            console.error('listtournaments slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to load tournaments.');
            }

            return interaction.reply({
                content: '❌ Failed to load tournaments.',
                ephemeral: true
            });
        }
    }
};

async function runList({
    guild,
    reply
}) {
    const tournaments = await TournamentSettings.find({
        guildId: guild.id
    }).sort({ createdAt: -1 });

    if (!tournaments.length) {
        return reply({
            content: '📭 No tournaments found.'
        });
    }

    const lines = [];

    for (const tournament of tournaments) {
        const teamCount = await TournamentTeam.countDocuments({
            guildId: guild.id,
            tournamentId: tournament._id,
            isActive: true
        });

        const playerCount = await TournamentPlayer.countDocuments({
            guildId: guild.id,
            tournamentId: tournament._id,
            isActive: true
        });

        lines.push(
            `🏆 **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n` +
            `Format: **${tournament.formatType}**\n` +
            `Phase: **${tournament.currentPhase}**\n` +
            `Teams: **${teamCount}**\n` +
            `Players: **${playerCount}**`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('🏟️ SERVER TOURNAMENTS')
        .setDescription(lines.join('\n\n'))
        .setTimestamp();

    return reply({ embeds: [embed] });
}