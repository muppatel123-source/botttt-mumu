/**
 * topstats.js
 *
 * View tournament leaderboards for player stats.
 * Paginated with category and tournament dropdown selectors.
 *
 * Usage:  .topstats [category]
 * Slash:  /topstats category:<value>
 * Aliases: top-stats, leaderstats, statleaders, lb
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

const {
    TournamentPlayer
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getSelectableTournaments,
    getTournamentByKey
} = require('../../utils/getTournament');

const PAGE_SIZE = 10;

const CATEGORIES = {
    goals: { label: 'GOALS', emoji: '⚽' },
    assists: { label: 'ASSISTS', emoji: '🎯' },
    saves: { label: 'SAVES', emoji: '🧤' },
    tackles: { label: 'TACKLES', emoji: '⚔️' },
    interceptions: { label: 'INTERCEPTIONS', emoji: '🛡️' },
    mvps: { label: 'MVPs', emoji: '👑' }
};

module.exports = {
    name: 'topstats',
    description: 'View tournament leaderboards for player stats.',
    usage: '.topstats [category]',
    aliases: ['top-stats', 'leaderstats', 'statleaders', 'lb'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('topstats')
        .setDescription('View tournament leaderboards')
        .addStringOption(opt =>
            opt.setName('category')
                .setDescription('Stat category')
                .setRequired(false)
                .addChoices(
                    { name: 'Goals', value: 'goals' },
                    { name: 'Assists', value: 'assists' },
                    { name: 'Saves', value: 'saves' },
                    { name: 'Tackles', value: 'tackles' },
                    { name: 'Interceptions', value: 'interceptions' },
                    { name: 'MVPs', value: 'mvps' }
                )
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            const category = (args[0] || 'goals').toLowerCase();

            return await runTopStats({
                guild: message.guild,
                category,
                userId: message.author.id,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[topstats] prefix error:', error);
            return message.reply('❌ Failed to load top stats.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const category = interaction.options.getString('category') || 'goals';

            return await runTopStats({
                guild: interaction.guild,
                category,
                userId: interaction.user.id,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[topstats] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to load top stats.');
            }

            return interaction.reply({
                content: '❌ Failed to load top stats.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runTopStats({
    guild,
    category,
    userId,
    reply
}) {
    if (!guild) {
        return reply({ content: '❌ This command can only be used in a server.' });
    }

    if (!CATEGORIES[category]) {
        return reply({ content: '❌ Invalid category.' });
    }

    const tournaments = await getSelectableTournaments(guild.id);

    if (!tournaments.length) {
        return reply({ content: '📭 No active tournaments found.' });
    }

    let tournament = await getDefaultTournament(guild.id);

    if (!tournament) {
        tournament = tournaments[0];
    }

    let selectedTournamentKey = tournament.tournamentKey;
    let selectedCategory = category;
    let page = 0;

    const payload = await buildTopStatsPayload({
        guildId: guild.id,
        tournament,
        tournaments,
        category: selectedCategory,
        page
    });

    const msg = await reply(payload);

    if (!msg?.createMessageComponentCollector) return;

    const collector = msg.createMessageComponentCollector({
        time: 600000
    });

    collector.on('collect', async interaction => {
        try {
            if (interaction.user.id !== userId) {
                return interaction.reply({
                    content: 'Not your menu.',
                    ephemeral: true
                });
            }

            if (interaction.isButton()) {
                if (interaction.customId === 'topstats_prev') page--;
                if (interaction.customId === 'topstats_next') page++;
            }

            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'topstats_category') {
                    selectedCategory = interaction.values[0];
                    page = 0;
                }

                if (interaction.customId === 'topstats_tournament') {
                    selectedTournamentKey = interaction.values[0];
                    tournament = await getTournamentByKey(guild.id, selectedTournamentKey);
                    page = 0;
                }
            }

            const updatedPayload = await buildTopStatsPayload({
                guildId: guild.id,
                tournament,
                tournaments,
                category: selectedCategory,
                page
            });

            await interaction.update(updatedPayload);
        } catch (error) {
            console.error('[topstats] collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Failed to update leaderboard.',
                    ephemeral: true
                }).catch(() => null);
            }
        }
    });

    collector.on('end', async () => {
        try {
            await msg.edit({
                components: []
            }).catch(() => null);
        } catch {}
    });
}

/* ====================================================
   PAYLOAD BUILDER
==================================================== */

async function buildTopStatsPayload({
    guildId,
    tournament,
    tournaments,
    category,
    page
}) {
    const rows = await TournamentPlayer.find({
        guildId,
        tournamentId: tournament._id,
        isActive: true,
        [`stats.${category}`]: { $gt: 0 }
    })
        .populate('playerId')
        .populate('teamId')
        .sort({
            [`stats.${category}`]: -1,
            'stats.played': 1,
            playerNameSnapshot: 1
        })
        .lean();

    const pages = chunk(rows, PAGE_SIZE);
    const totalPages = Math.max(pages.length, 1);

    page = Math.max(0, Math.min(page, totalPages - 1));

    const embed = buildEmbed({
        tournament,
        category,
        rows,
        page,
        totalPages,
        list: pages[page] || []
    });

    return {
        embeds: [embed],
        components: [
            buildTournamentDropdown(tournaments, tournament.tournamentKey),
            buildCategoryDropdown(category),
            buildPaginationButtons(page, totalPages)
        ]
    };
}

/* ====================================================
   EMBED BUILDER
==================================================== */

function buildEmbed({
    tournament,
    category,
    rows,
    page,
    totalPages,
    list
}) {
    const meta = CATEGORIES[category];

    const table = list.length
        ? list.map((entry, index) => {
            const rank = String(page * PAGE_SIZE + index + 1).padStart(2, '0');
            const name = truncate(entry.playerNameSnapshot || entry.playerId?.name || 'Unknown', 16).padEnd(16, ' ');
            const stat = String(entry.stats?.[category] || 0).padStart(2, '0');

            return `${rank} | ${name} | ${stat}`;
        }).join('\n')
        : 'No records yet.';

    const activeTalents = list.length
        ? list.map((entry, index) => {
            const rank = page * PAGE_SIZE + index + 1;
            const discordID = entry.playerId?.discordID;
            const name = entry.playerNameSnapshot || entry.playerId?.name || 'Unknown';

            return discordID
                ? `[${rank}] <@${discordID}>`
                : `[${rank}] ${name}`;
        }).join(' • ')
        : '—';

    return new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle(`${meta.emoji} ${meta.label} LEADERBOARD`)
        .setDescription(
            `🏆 **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            '```' +
            'RANK | PLAYER           | STAT\n' +
            '--------------------------------\n' +
            table +
            '```'
        )
        .addFields({
            name: '✨ Active Talents',
            value: activeTalents
        })
        .setFooter({
            text: `Page ${page + 1} of ${totalPages} • Total Contributors: ${rows.length}`
        })
        .setTimestamp();
}

/* ====================================================
   COMPONENT BUILDERS
==================================================== */

function buildTournamentDropdown(tournaments, selectedKey) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('topstats_tournament')
            .setPlaceholder('Select tournament')
            .addOptions(
                tournaments.slice(0, 25).map(tournament => ({
                    label: truncate(tournament.name || tournament.tournamentKey, 80),
                    description: `Key: ${tournament.tournamentKey}`,
                    value: tournament.tournamentKey,
                    default: tournament.tournamentKey === selectedKey
                }))
            )
    );
}

function buildCategoryDropdown(selectedCategory) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('topstats_category')
            .setPlaceholder('Select stat category')
            .addOptions(
                Object.entries(CATEGORIES).map(([key, data]) => ({
                    label: data.label,
                    emoji: data.emoji,
                    value: key,
                    default: key === selectedCategory
                }))
            )
    );
}

function buildPaginationButtons(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('topstats_prev')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),

        new ButtonBuilder()
            .setCustomId('topstats_next')
            .setLabel('Next ➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages - 1)
    );
}

/* ====================================================
   HELPERS
==================================================== */

function chunk(array, size) {
    const result = [];

    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }

    return result;
}

function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
}
