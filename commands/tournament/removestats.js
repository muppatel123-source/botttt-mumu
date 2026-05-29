const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    TournamentSettings,
    TournamentPlayer,
    UserProfile
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'removestats',
    description: 'Remove raw match stats from a tournament.',
    usage: '.removestats <key> [raw stats]',
    aliases: ['rs', 'undostats'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('removestats')
        .setDescription('Remove raw stats from tournament players')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('stats')
                .setDescription('Optional raw stats text')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (!args.length) {
                return message.reply('❓ Usage: `.rs <tournamentKey>` or reply to raw stats with `.rs <tournamentKey>`');
            }

            const tournamentKey = args[0].toLowerCase();
            let rawText = args.slice(1).join(' ').trim();

            if (!rawText && message.reference?.messageId) {
                const replied = await message.channel.messages
                    .fetch(message.reference.messageId)
                    .catch(() => null);

                if (replied) rawText = replied.content || '';
            }

            if (!rawText) {
                return message.reply('❌ No raw stats text found.');
            }

            return await runRemoveStats({
                guild: message.guild,
                tournamentKey,
                rawText,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('removestats prefix error:', error);
            return message.reply('❌ Failed to remove stats.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const tournamentKey = interaction.options.getString('key').toLowerCase();
            const rawText = interaction.options.getString('stats');

            if (!rawText) {
                return interaction.editReply('❌ Slash version requires raw stats text.');
            }

            return await runRemoveStats({
                guild: interaction.guild,
                tournamentKey,
                rawText,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('removestats slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to remove stats.');
            }

            return interaction.reply({
                content: '❌ Failed to remove stats.',
                ephemeral: true
            });
        }
    }
};

async function runRemoveStats({
    guild,
    tournamentKey,
    rawText,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({ content: `❌ Tournament \`${tournamentKey}\` not found.` });
    }

    const groupedStats = parseRawStatsGrouped(rawText);

    if (!groupedStats.size) {
        return reply({ content: '❌ Could not parse any stats.' });
    }

    let updatedPlayers = 0;

    const removedLines = [];
    const skippedLines = [];

    let totals = {
        played: 0,
        goals: 0,
        assists: 0,
        tackles: 0,
        interceptions: 0,
        saves: 0
    };

    for (const [playerName, statsToRemove] of groupedStats.entries()) {
        const tournamentPlayer = await TournamentPlayer.findOne({
            guildId: guild.id,
            tournamentId: tournament._id,
            name: {
                $regex: new RegExp(`^${escapeRegex(playerName)}$`, 'i')
            },
            isActive: true
        });

        if (!tournamentPlayer) {
            skippedLines.push(`• Player not found: **${playerName}**`);
            continue;
        }

        const actuallyRemoved = subtractStatsObject(
            tournamentPlayer.stats,
            statsToRemove,
            true
        );

        await tournamentPlayer.save();

        await subtractFromUserProfile({
            guildId: guild.id,
            discordID: tournamentPlayer.discordID,
            statsToRemove
        });

        updatedPlayers++;

        totals.played += actuallyRemoved.played;
        totals.goals += actuallyRemoved.goals;
        totals.assists += actuallyRemoved.assists;
        totals.tackles += actuallyRemoved.tackles;
        totals.interceptions += actuallyRemoved.interceptions;
        totals.saves += actuallyRemoved.saves;

        removedLines.push(
            `**${tournamentPlayer.name}**: ` +
            buildRemovedText(actuallyRemoved)
        );
    }

    const embed = new EmbedBuilder()
        .setColor(updatedPlayers > 0 ? 0xE67E22 : 0xE74C3C)
        .setTitle('➖ MATCH STATS REMOVED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Updated players: **${updatedPlayers}**`
        )
        .addFields(
            {
                name: 'Removed Stats',
                value: removedLines.length
                    ? removedLines.slice(0, 20).join('\n')
                    : 'No stats removed.',
                inline: false
            },
            {
                name: 'Totals Removed',
                value:
                    `🏟️ Played: **${totals.played}**\n` +
                    `⚽ Goals: **${totals.goals}**\n` +
                    `🎯 Assists: **${totals.assists}**\n` +
                    `⚔️ Tackles: **${totals.tackles}**\n` +
                    `🧠 Interceptions: **${totals.interceptions}**\n` +
                    `🧤 Saves: **${totals.saves}**`,
                inline: false
            }
        )
        .setTimestamp();

    if (skippedLines.length) {
        embed.addFields({
            name: 'Skipped',
            value: skippedLines.slice(0, 10).join('\n'),
            inline: false
        });
    }

    return reply({ embeds: [embed] });
}

async function subtractFromUserProfile({
    guildId,
    discordID,
    statsToRemove
}) {
    if (!discordID) return;

    const profile = await UserProfile.findOne({
        guildId,
        discordID
    });

    if (!profile) return;

    subtractStatsObject(
        profile.allTimeStats,
        statsToRemove,
        true
    );

    await profile.save();
}

function subtractStatsObject(targetStats, statsToRemove, removePlayed) {
    if (!targetStats) return emptyRemoved();

    const removed = emptyRemoved();

    if (removePlayed) {
        removed.played = Math.min(targetStats.played || 0, 1);
        targetStats.played = Math.max(0, (targetStats.played || 0) - 1);
    }

    for (const key of ['goals', 'assists', 'tackles', 'interceptions', 'saves']) {
        const amount = statsToRemove[key] || 0;
        const current = targetStats[key] || 0;

        const removeAmount = Math.min(current, amount);

        targetStats[key] = Math.max(0, current - removeAmount);
        removed[key] = removeAmount;
    }

    return removed;
}

function emptyRemoved() {
    return {
        played: 0,
        goals: 0,
        assists: 0,
        tackles: 0,
        interceptions: 0,
        saves: 0
    };
}

function parseRawStatsGrouped(text) {
    const grouped = new Map();

    const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const parsed = parseLine(line);
        if (!parsed) continue;

        const existing = grouped.get(parsed.name) || emptyRemoved();

        existing[parsed.type] += parsed.value;

        grouped.set(parsed.name, existing);
    }

    return grouped;
}

function parseLine(line) {
    const patterns = [
        { type: 'goals', regex: /^(.+?)\s*[-:]\s*(\d+)\s+goals?/i },
        { type: 'assists', regex: /^(.+?)\s*[-:]\s*(\d+)\s+assists?/i },
        { type: 'tackles', regex: /^(.+?)\s*[-:]\s*(\d+)\s+tackles?/i },
        { type: 'interceptions', regex: /^(.+?)\s*[-:]\s*(\d+)\s+interceptions?/i },
        { type: 'saves', regex: /^(.+?)\s*[-:]\s*(\d+)\s+saves?/i }
    ];

    for (const pattern of patterns) {
        const match = line.match(pattern.regex);

        if (!match) continue;

        return {
            name: match[1].trim(),
            type: pattern.type,
            value: Number(match[2])
        };
    }

    return null;
}

function buildRemovedText(stats) {
    const parts = [];

    if (stats.played) parts.push(`-1 played`);
    if (stats.goals) parts.push(`-${stats.goals} goals`);
    if (stats.assists) parts.push(`-${stats.assists} assists`);
    if (stats.tackles) parts.push(`-${stats.tackles} tackles`);
    if (stats.interceptions) parts.push(`-${stats.interceptions} interceptions`);
    if (stats.saves) parts.push(`-${stats.saves} saves`);

    return parts.length ? parts.join(', ') : 'nothing removed';
}

function escapeRegex(text) {
    return String(text).replace(
        /[-\/\\^$*+?.()|[\]{}]/g,
        '\\$&'
    );
}