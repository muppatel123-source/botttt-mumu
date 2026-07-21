const {
    EmbedBuilder
} = require('discord.js');

const {
    TournamentPlayer,
    TournamentSettings
} = require('../models/Tournament');

const LiveMessage = require('../models/LiveMessage');

const CATEGORIES = [
    { key: 'goals', label: 'Goals', emoji: '<:Goal:1488855482142556180>' },
    { key: 'assists', label: 'Assists', emoji: '<:Assist:1488530563500605532>' },
    { key: 'saves', label: 'Saves', emoji: '<:saves:1488530642127028358>' },
    { key: 'tackles', label: 'Tackles', emoji: '<:tackles:1488530871668703255>' },
    { key: 'interceptions', label: 'Interceptions', emoji: '🧠' },
    { key: 'mvps', label: 'MVPs', emoji: '<:mvp:1488530468184920195>' }
];

async function updateLiveTopStats(client, guildId) {
    try {
        const liveMessages = await LiveMessage.find({
            guildId,
            type: 'topstats'
        });

        for (const live of liveMessages) {
            await updateSingleTopStats(client, guildId, live);
        }

        return true;
    } catch (error) {
        console.error('updateLiveTopStats error:', error);
        return false;
    }
}

async function updateSingleTopStats(client, guildId, live) {
    const settings = await TournamentSettings.findOne({
        guildId,
        tournamentKey: live.tournamentKey
    });

    if (!settings) return false;

    const channel = await client.channels.fetch(live.channelId).catch(() => null);
    if (!channel) return false;

    const message = await channel.messages.fetch(live.messageId).catch(() => null);
    if (!message) return false;

    const players = await TournamentPlayer.find({
        guildId,
        tournamentId: settings._id,
        isActive: true
    }).populate('playerId').lean();

    const embed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('🏆 LIVE TOP STATS')
        .setDescription(
            `**${settings.name.toUpperCase()}**\n` +
            `Key: \`${settings.tournamentKey}\`\n\n` +
            `Updated automatically after stats are added.`
        )
        .setFooter({ text: 'Last Updated' })
        .setTimestamp();

    for (const category of CATEGORIES) {
        const top = players
            .filter(p => (p.stats?.[category.key] || 0) > 0)
            .sort((a, b) => {
                const diff =
                    (b.stats?.[category.key] || 0) -
                    (a.stats?.[category.key] || 0);

                if (diff !== 0) return diff;

                return (a.stats?.played || 0) -
                    (b.stats?.played || 0);
            })
            .slice(0, 5);

        const value = top.length
            ? top.map((p, i) => {
                const stat = p.stats?.[category.key] || 0;

                return `**${i + 1}.** ${p.playerNameSnapshot} — **${stat}**`;
            }).join('\n')
            : 'No records yet.';

        embed.addFields({
            name: `${category.emoji} ${category.label}`,
            value,
            inline: true
        });
    }

    await message.edit({
        content: null,
        embeds: [embed]
    });

    return true;
}

module.exports = {
    updateLiveTopStats
};