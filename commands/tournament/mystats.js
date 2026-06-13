/**
 * mystats.js
 *
 * View player stats with interactive views:
 * - Tournament Stats (per-tournament)
 * - All-Time Stats (career totals from UserProfile)
 * - Trophies (all trophies won)
 * - Awards (special awards like Ballon d'Or, Golden Boot, etc.)
 *
 * Usage:  .mystats [@user/userId]
 * Slash:  /mystats [user]
 *
 * Aliases: statsme, playerstats, stats, s
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    UserProfile,
    ServerConfig,
    TournamentSettings
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getSelectableTournaments,
    getTournamentByKey
} = require('../../utils/getTournament');

const { getUserFromArgs } = require('../../utils/stringHelpers');
const { truncate, parseColor } = require('../../utils/displayHelpers');

const DEFAULT_TROPHY_EMOJI = '<:_Trophy:1507987705311793152>';

module.exports = {
    name: 'mystats',
    description: 'View your player stats.',
    usage: '.mystats [@user/userId]',
    aliases: ['statsme', 'playerstats', 'stats', 's'],
    hidden: false,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('mystats')
        .setDescription('View your player stats')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Optional player to inspect')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args = []) {
        try {
            if (!message.guild) return;

            const target = await resolvePrefixTarget(message, args) || message.author;

            return await runMyStats({
                guild: message.guild,
                targetUserId: target.id,
                fallbackTag: target.tag || target.username || 'Unknown User',
                fallbackAvatar: target.displayAvatarURL
                    ? target.displayAvatarURL({ dynamic: true, size: 512 })
                    : message.author.displayAvatarURL({ dynamic: true, size: 512 }),
                viewerId: message.author.id,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[mystats] prefix error:', error);
            return message.reply('❌ Failed to load player stats.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const user = interaction.options.getUser('user') || interaction.user;

            return await runMyStats({
                guild: interaction.guild,
                targetUserId: user.id,
                fallbackTag: user.tag,
                fallbackAvatar: user.displayAvatarURL({ dynamic: true, size: 512 }),
                viewerId: interaction.user.id,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[mystats] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to load player stats.');
            }

            return interaction.reply({ content: '❌ Failed to load player stats.', ephemeral: true });
        }
    }
};

/* ====================================================
   TARGET RESOLUTION (PREFIX)
==================================================== */

/**
 * Resolve the target user from prefix args.
 * Supports @mention, raw Discord ID, and Discord username lookup.
 * Falls back to message.author if no target specified.
 */
async function resolvePrefixTarget(message, args = []) {
    /* ── Try @mention ── */
    const mentionedUser = message.mentions.users.first();
    if (mentionedUser) return mentionedUser;

    /* ── Try getUserFromArgs (ID + username) ── */
    if (args.length) {
        const resolved = await getUserFromArgs(message, args);
        if (resolved) return resolved;
    }

    /* ── Fallback: self ── */
    return null;
}

/* ====================================================
   CORE LOGIC
==================================================== */

async function runMyStats({ guild, targetUserId, fallbackTag, fallbackAvatar, viewerId, reply }) {
    const globalPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUserId
    }).populate('teamId');

    if (!globalPlayer) {
        return reply({ content: '❌ No player profile found.' });
    }

    const tournaments = await getSelectableTournaments(guild.id, { includeCompleted: true });
    if (!tournaments.length) {
        return reply({ content: '❌ No tournaments found.' });
    }

    let tournament = await getDefaultTournament(guild.id, { includeCompleted: true });
    if (!tournament) tournament = tournaments[0];

    let view = 'tournament';

    const payload = await buildPayload({
        guild,
        globalPlayer,
        tournament,
        tournaments,
        view,
        fallbackTag,
        fallbackAvatar
    });

    const msg = await reply(payload);

    if (!msg?.createMessageComponentCollector) return;

    const collector = msg.createMessageComponentCollector({ time: 600000 });

    collector.on('collect', async interaction => {
        try {
            if (interaction.user.id !== viewerId) {
                return interaction.reply({ content: 'Not your menu.', ephemeral: true });
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'mystats_tournament') {
                const selectedTournament = await getTournamentByKey(
                    guild.id,
                    interaction.values[0],
                    { includeCompleted: true }
                );

                if (selectedTournament) tournament = selectedTournament;
                view = 'tournament';
            }

            if (interaction.isButton()) {
                if (interaction.customId === 'mystats_tournament_view') view = 'tournament';
                if (interaction.customId === 'mystats_alltime') view = 'alltime';
                if (interaction.customId === 'mystats_trophies') view = 'trophies';
                if (interaction.customId === 'mystats_awards') view = 'awards';
            }

            const updatedPayload = await buildPayload({
                guild,
                globalPlayer,
                tournament,
                tournaments,
                view,
                fallbackTag,
                fallbackAvatar
            });

            await interaction.update(updatedPayload);
        } catch (error) {
            console.error('[mystats] collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Failed to update stats view.', ephemeral: true }).catch(() => null);
            }
        }
    });

    collector.on('end', async () => {
        await msg.edit({ components: [] }).catch(() => null);
    });
}

/* ====================================================
   PAYLOAD BUILDER
==================================================== */

async function buildPayload({ guild, globalPlayer, tournament, tournaments, view, fallbackTag, fallbackAvatar }) {
    const config = await ServerConfig.findOne({ guildId: guild.id }).lean();

    // ── Per-guild profile (allTimeStats) ──
    const profile = await UserProfile.findOne({
        guildId: guild.id,
        discordID: globalPlayer.discordID
    }).lean();

    // ── Global trophies & awards (all servers) ──
    const globalProfiles = await UserProfile.find({
        discordID: globalPlayer.discordID
    }).lean();

    const globalTrophies = [];
    const globalAwards = [];

    // Build guild name map for cross-server labels
    const guildNameMap = new Map();

    for (const gp of globalProfiles) {
        // Resolve server name from client cache
        if (gp.guildId && !guildNameMap.has(gp.guildId)) {
            const g = guild.client.guilds.cache.get(gp.guildId);
            guildNameMap.set(gp.guildId, g?.name || 'Unknown Server');
        }

        if (Array.isArray(gp.trophies)) {
            for (const t of gp.trophies) {
                t._sourceGuildId = gp.guildId;
                globalTrophies.push(t);
            }
        }
        if (Array.isArray(gp.awards)) {
            for (const a of gp.awards) {
                a._sourceGuildId = gp.guildId;
                globalAwards.push(a);
            }
        }
    }

    const tournamentPlayer = await TournamentPlayer.findOne({
        guildId: guild.id,
        tournamentId: tournament._id,
        playerId: globalPlayer._id,
        isActive: true
    }).lean();

    const emojis = getEmojiPack(config);
    const tournamentEmojiMap = await getTournamentEmojiMap(guild.id);

    const embed =
        view === 'alltime'
            ? buildAllTimeEmbed({ guild, globalPlayer, profile, emojis, fallbackTag, fallbackAvatar })
            : view === 'trophies'
                ? buildTrophiesEmbed({ guild, globalPlayer, profile, emojis, tournamentEmojiMap, fallbackTag, fallbackAvatar, globalTrophies, guildNameMap })
                : view === 'awards'
                    ? buildAwardsEmbed({ guild, globalPlayer, profile, emojis, fallbackTag, fallbackAvatar, globalAwards, guildNameMap })
                    : buildTournamentEmbed({ guild, globalPlayer, tournament, tournamentPlayer, emojis, fallbackTag, fallbackAvatar });

    return {
        embeds: [embed],
        components: [
            buildTournamentDropdown(tournaments, tournament.tournamentKey),
            buildButtons(view)
        ]
    };
}

/* ====================================================
   EMBED BUILDERS
==================================================== */

function buildTournamentEmbed({ guild, globalPlayer, tournament, tournamentPlayer, emojis, fallbackTag, fallbackAvatar }) {
    const team = globalPlayer.teamId || null;
    const teamName = team?.name || globalPlayer.teamNameSnapshot || 'No Team';
    const teamColor = parseColor(team?.color, null);
    const stats = tournamentPlayer?.stats || {};
    const contributions = (stats.goals || 0) + (stats.assists || 0);
    const tournamentEmoji = tournament.emoji || '🏆';

    return new EmbedBuilder()
        .setColor(teamColor || 0xFEBE10)
        .setAuthor({
            name: `${teamName} Profile`,
            iconURL: team?.logoURL || guild.iconURL() || fallbackAvatar
        })
        .setTitle(`🥇 PLAYER CARD: ${globalPlayer.name.toUpperCase()}`)
        .setDescription(
            `${tournamentEmoji} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\``
        )
        .setThumbnail(fallbackAvatar || guild.iconURL())
        .addFields(
            {
                name: '👤 Player Info',
                value:
                    `User: <@${globalPlayer.discordID}>\n` +
                    `Team: **${teamName}**\n` +
                    `Captain: **${globalPlayer.isCaptain ? 'Yes' : 'No'}**`,
                inline: false
            },
            { name: `${emojis.stats.played} Matches Played`, value: `\`${stats.played || 0}\``, inline: false },
            { name: `${emojis.stats.mvps} MVPs`, value: `\`${stats.mvps || 0}\``, inline: true },
            { name: `${emojis.stats.goals} Goals`, value: `\`${stats.goals || 0}\``, inline: true },
            { name: `${emojis.stats.assists} Assists`, value: `\`${stats.assists || 0}\``, inline: true },
            { name: `${emojis.stats.saves} Saves`, value: `\`${stats.saves || 0}\``, inline: true },
            { name: `${emojis.stats.tackles} Tackles`, value: `\`${stats.tackles || 0}\``, inline: true },
            { name: `${emojis.stats.interceptions} Interceptions`, value: `\`${stats.interceptions || 0}\``, inline: true },
            { name: `${emojis.stats.ga} G+A`, value: `\`${contributions}\``, inline: true }
        )
        .setFooter({ text: fallbackTag })
        .setTimestamp();
}

function buildAllTimeEmbed({ guild, globalPlayer, profile, emojis, fallbackTag, fallbackAvatar }) {
    const stats = profile?.allTimeStats || {};
    const contributions = (stats.goals || 0) + (stats.assists || 0);

    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🌍 ALL-TIME STATS — ${globalPlayer.name.toUpperCase()}`)
        .setThumbnail(fallbackAvatar || guild.iconURL())
        .addFields(
            { name: `${emojis.stats.played} Career Matches`, value: `\`${stats.played || 0}\``, inline: false },
            { name: `${emojis.stats.goals} Goals`, value: `\`${stats.goals || 0}\``, inline: true },
            { name: `${emojis.stats.assists} Assists`, value: `\`${stats.assists || 0}\``, inline: true },
            { name: `${emojis.stats.mvps} MVPs`, value: `\`${stats.mvps || 0}\``, inline: true },
            { name: `${emojis.stats.saves} Saves`, value: `\`${stats.saves || 0}\``, inline: true },
            { name: `${emojis.stats.tackles} Tackles`, value: `\`${stats.tackles || 0}\``, inline: true },
            { name: `${emojis.stats.interceptions} Interceptions`, value: `\`${stats.interceptions || 0}\``, inline: true },
            { name: `${emojis.stats.ga} G+A`, value: `\`${contributions}\``, inline: true }
        )
        .setFooter({ text: fallbackTag })
        .setTimestamp();
}

function buildTrophiesEmbed({ guild, globalPlayer, profile, emojis, tournamentEmojiMap, fallbackTag, fallbackAvatar, globalTrophies, guildNameMap }) {
    const trophyLines = (globalTrophies || [])
        .slice(0, 25)
        .map(trophy => formatTrophyLine(trophy, emojis, tournamentEmojiMap, guild.id, guildNameMap))
        .filter(Boolean);

    return new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`${emojis.trophy.default} TROPHIES — ${globalPlayer.name.toUpperCase()}`)
        .setThumbnail(fallbackAvatar || guild.iconURL())
        .setDescription(trophyLines.length ? trophyLines.join('\n') : 'No trophies won yet.')
        .setFooter({ text: fallbackTag })
        .setTimestamp();
}

function buildAwardsEmbed({ guild, globalPlayer, profile, emojis, fallbackTag, fallbackAvatar, globalAwards, guildNameMap }) {
    const awards = globalAwards || [];

    return new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🏅 AWARDS — ${globalPlayer.name.toUpperCase()}`)
        .setThumbnail(fallbackAvatar || guild.iconURL())
        .setDescription(
            awards.length
                ? awards.slice(0, 25).map(award => {
                    const awardEmoji = award.emoji || emojis.awards[award.awardType] || '🏅';
                    const awardName = award.name || cleanAwardTitle(award.title) || prettyAwardType(award.awardType);
                    const tournamentName = award.tournamentName || award.tournamentKey || 'Tournament';
                    const serverLabel = buildServerLabel(award._sourceGuildId, guild.id, guildNameMap);

                    return `${awardEmoji} **${tournamentName} ${awardName}**${serverLabel}`;
                }).join('\n')
                : 'No awards earned yet.'
        )
        .setFooter({ text: fallbackTag })
        .setTimestamp();
}

/* ====================================================
   UI COMPONENTS
==================================================== */

function buildTournamentDropdown(tournaments, selectedKey) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('mystats_tournament')
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

function buildButtons(view) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mystats_tournament_view')
            .setLabel('Tournament Stats')
            .setStyle(view === 'tournament' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('mystats_alltime')
            .setLabel('All-Time')
            .setStyle(view === 'alltime' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('mystats_trophies')
            .setLabel('Trophies')
            .setStyle(view === 'trophies' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('mystats_awards')
            .setLabel('Awards')
            .setStyle(view === 'awards' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
}

/* ====================================================
   EMOJI CONFIG
==================================================== */

function getEmojiPack(config) {
    return {
        stats: {
            played: config?.emojis?.stats?.played || '<:Stadium:1487010283506630776>',
            goals: config?.emojis?.stats?.goals || '<:Goal:1488855482142556180>',
            assists: config?.emojis?.stats?.assists || '<:Assist:1488530563500605532>',
            saves: config?.emojis?.stats?.saves || '<:saves:1488530642127028358>',
            tackles: config?.emojis?.stats?.tackles || '<:tackles:1488530871668703255>',
            interceptions: config?.emojis?.stats?.interceptions || '🧠',
            mvps: config?.emojis?.stats?.mvps || '<:mvp:1488530468184920195>',
            ga: config?.emojis?.stats?.ga || '🔥'
        },
        awards: {
            ballon_dor: config?.emojis?.awards?.ballon_dor || '🏆',
            golden_boot: config?.emojis?.awards?.golden_boot || '⚽',
            golden_glove: config?.emojis?.awards?.golden_glove || '🧤',
            playmaker: config?.emojis?.awards?.playmaker || '🎯'
        },
        trophy: {
            default: config?.emojis?.trophy?.default || config?.emojis?.trophies?.default || DEFAULT_TROPHY_EMOJI,
            champion: config?.emojis?.trophy?.champion || config?.emojis?.trophies?.champion || config?.emojis?.trophy?.default || config?.emojis?.trophies?.default || DEFAULT_TROPHY_EMOJI,
            runner_up: config?.emojis?.trophy?.runner_up || config?.emojis?.trophies?.runner_up || '🥈'
        }
    };
}

async function getTournamentEmojiMap(guildId) {
    const tournaments = await TournamentSettings.find({ guildId })
        .select('tournamentKey emoji')
        .lean()
        .catch(() => []);

    const map = new Map();
    for (const tournament of tournaments) {
        if (tournament.tournamentKey && tournament.emoji) {
            map.set(tournament.tournamentKey, tournament.emoji);
        }
    }
    return map;
}

/* ====================================================
   TROPHY & AWARD FORMATTING
==================================================== */

/**
 * Build a server label for cross-server trophies/awards.
 * Returns empty string for same-server items.
 * Returns " — ServerName" for different-server items.
 */
function buildServerLabel(sourceGuildId, currentGuildId, guildNameMap) {
    if (!sourceGuildId || sourceGuildId === currentGuildId) return '';

    const serverName = guildNameMap?.get(sourceGuildId) || 'Unknown Server';

    return ` — ${serverName}`;
}

function formatTrophyLine(trophy, emojis, tournamentEmojiMap, currentGuildId, guildNameMap) {
    const clean = normalizeTrophy(trophy, emojis, tournamentEmojiMap);
    if (!clean) return null;

    const serverLabel = buildServerLabel(trophy._sourceGuildId, currentGuildId, guildNameMap);

    return `${clean.emoji} **${clean.tournamentName} ${clean.label}**${serverLabel}`;
}

function normalizeTrophy(trophy, emojis, tournamentEmojiMap) {
    if (!trophy) return null;

    const tournamentName = trophy.tournamentName || trophy.tournamentKey || 'Tournament';
    const tournamentKey = trophy.tournamentKey || '';

    let label = '';

    if (trophy.type === 'champion') label = 'Winner';
    else if (trophy.type === 'runner_up') label = 'Runner Up';
    else if (String(trophy.name || '').toLowerCase() === 'winner') label = 'Winner';
    else if (String(trophy.name || '').toLowerCase() === 'runner up') label = 'Runner Up';
    else if (String(trophy.label || '').toLowerCase() === 'winner') label = 'Winner';
    else if (String(trophy.label || '').toLowerCase() === 'runner up') label = 'Runner Up';
    else if (String(trophy.title || '').toLowerCase().includes('winner')) label = 'Winner';
    else if (String(trophy.title || '').toLowerCase().includes('runner up')) label = 'Runner Up';

    if (!label) return null;

    const tournamentEmoji = tournamentKey && tournamentEmojiMap?.get(tournamentKey)
        ? tournamentEmojiMap.get(tournamentKey)
        : null;

    const savedEmoji = String(trophy.emoji || '').trim();
    const genericWinnerEmojis = new Set(['🏆', '🏅', '🥇']);
    const genericRunnerEmojis = new Set(['🥈', '🏅']);

    let emoji;

    if (label === 'Winner') {
        emoji =
            tournamentEmoji ||
            emojis?.trophy?.champion ||
            emojis?.trophy?.default ||
            (savedEmoji && !genericWinnerEmojis.has(savedEmoji) ? savedEmoji : null) ||
            DEFAULT_TROPHY_EMOJI;
    } else if (label === 'Runner Up') {
        emoji =
            tournamentEmoji ||
            emojis?.trophy?.runner_up ||
            (savedEmoji && !genericRunnerEmojis.has(savedEmoji) ? savedEmoji : null) ||
            '🥈';
    } else {
        emoji = tournamentEmoji || savedEmoji || emojis?.trophy?.default || DEFAULT_TROPHY_EMOJI;
    }

    return { tournamentName, label, emoji };
}

function cleanAwardTitle(title) {
    let value = String(title || '').trim();
    if (!value) return '';

    value = value
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/[🏆⚽🧤🎯🏅🥇🥈🥉]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return value;
}

function prettyAwardType(type) {
    const map = {
        ballon_dor: "Ballon d'Or",
        golden_boot: 'Golden Boot',
        golden_glove: 'Golden Glove',
        playmaker: 'Playmaker'
    };

    return map[type] || 'Award';
}
