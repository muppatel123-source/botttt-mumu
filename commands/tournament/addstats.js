/**
 * addstats.js
 *
 * Bulk add raw handfootball player stats from CSV data.
 * Organizers can reply to a stats message with `.as` or paste data directly.
 * Updates TournamentPlayer + UserProfile (all-time), then refreshes live top stats.
 * Sends a detailed DM report to the organizer.
 *
 * Input format (per line):
 *   discordID, goals, assists, interceptions, tackles, saves
 *
 * Usage: .as [tournamentKey] (reply to stats message)
 *        .as [tournamentKey] <pasted lines>
 * Slash: /addstats key:<key> data:<lines> count_played:<bool>
 *
 * Aliases: as
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const { Player, TournamentPlayer, UserProfile } = require('../../models/Tournament');
const { getDefaultTournament, getTournamentByKey } = require('../../utils/getTournament');
const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'addstats',
    description: 'Bulk add raw handfootball player stats.',
    usage: '.addstats [tournamentKey] or reply to raw stats message with .as [tournamentKey]',
    aliases: ['as'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('addstats')
        .setDescription('Bulk add raw handfootball player stats')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('data')
                .setDescription('Fallback raw stats lines')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt.setName('count_played')
                .setDescription('Add +1 appearance for each valid row')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized to use this command.');
            }

            const possibleKey = args[0]?.toLowerCase();
            const tournament = await resolveTournament(message.guild.id, possibleKey);

            if (!tournament) {
                return message.reply('❌ Tournament not found. Set a default tournament or use `.as <tournamentKey>`.');
            }

            const firstArgIsKey = Boolean(possibleKey && possibleKey === tournament.tournamentKey);
            const rawData = await getRawStatsFromMessage(message, args, firstArgIsKey);

            if (!rawData) {
                return message.reply(
                    '❓ Reply to the HandFootball raw stats message with `.as` or use `.as <tournamentKey>`.'
                );
            }

            const waitMsg = await message.reply('⏳ Processing raw match stats...');

            return await processStats({
                client: message.client,
                guild: message.guild,
                tournament,
                rawData,
                countPlayed: true,
                organizerUser: message.author,
                respondFinal: payload => waitMsg.edit(payload)
            });
        } catch (error) {
            console.error('[addstats] prefix error:', error);
            return message.reply('❌ Failed to process raw stats.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized to use this command.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const key = interaction.options.getString('key')?.toLowerCase() || null;
            const tournament = await resolveTournament(interaction.guild.id, key);

            if (!tournament) {
                return interaction.editReply('❌ Tournament not found. Set a default tournament or provide a valid key.');
            }

            const rawData = interaction.options.getString('data');

            if (!rawData) {
                return interaction.editReply('❌ Slash version needs pasted data. For reply-based stats, use `.as`.');
            }

            return await processStats({
                client: interaction.client,
                guild: interaction.guild,
                tournament,
                rawData,
                countPlayed: interaction.options.getBoolean('count_played') ?? true,
                organizerUser: interaction.user,
                respondFinal: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[addstats] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to process raw stats.');
            }

            return interaction.reply({
                content: '❌ Failed to process raw stats.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   TOURNAMENT RESOLUTION
==================================================== */

/**
 * Resolve a tournament from a key, or fall back to the server default.
 * Includes completed tournaments so stats can be added retroactively.
 */
async function resolveTournament(guildId, key) {
    if (key) {
        const found = await getTournamentByKey(guildId, key, { includeCompleted: true });
        if (found) return found;
    }

    return getDefaultTournament(guildId, { includeCompleted: true });
}

/* ====================================================
   RAW DATA EXTRACTION
==================================================== */

/**
 * Extract raw stats data from a replied message or command args.
 * Supports code blocks and plain CSV lines.
 */
async function getRawStatsFromMessage(message, args, firstArgIsKey) {
    // Try fetching the replied-to message
    const replied = message.reference?.messageId
        ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
        : null;

    if (replied?.content) {
        return extractRawStatsBlock(replied.content);
    }

    // Fall back to args
    const contentArgs = firstArgIsKey ? args.slice(1) : args;
    if (!contentArgs.length) return '';

    return contentArgs.join(' ');
}

/**
 * Extract a stats block from message content.
 * Tries code block first, then filters lines starting with a Discord ID.
 */
function extractRawStatsBlock(content) {
    const codeBlockMatch = content.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^\d{17,20}\s*,/.test(line))
        .join('\n');
}

/* ====================================================
   CORE PROCESSING
==================================================== */

/**
 * Parse and apply bulk stats to tournament players.
 * Also updates UserProfile all-time stats and DMs the organizer a report.
 */
async function processStats({ client, guild, tournament, rawData, countPlayed, organizerUser, respondFinal }) {
    const lines = rawData.split('\n').map(line => line.trim()).filter(Boolean);

    const successLog = [];
    const skippedLog = [];

    let processedCount = 0;
    let skippedCount = 0;

    const totals = {
        goals: 0,
        assists: 0,
        interceptions: 0,
        tackles: 0,
        saves: 0,
        played: 0
    };

    for (const line of lines) {
        const parsed = parseRawStatLine(line);

        if (!parsed.ok) {
            skippedCount++;
            skippedLog.push(`Invalid line: ${line}`);
            continue;
        }

        const { discordID, goals, assists, interceptions, tackles, saves } = parsed.data;

        // ── Find player ──
        const player = await Player.findOne({ guildId: guild.id, discordID });

        if (!player) {
            skippedCount++;
            skippedLog.push(`Player not found: ${discordID}`);
            continue;
        }

        // ── Build increment ──
        const inc = {
            'stats.goals': goals,
            'stats.assists': assists,
            'stats.interceptions': interceptions,
            'stats.tackles': tackles,
            'stats.saves': saves
        };

        if (countPlayed) {
            inc['stats.played'] = 1;
        }

        // ── Update tournament player ──
        const tp = await TournamentPlayer.findOneAndUpdate(
            { guildId: guild.id, tournamentId: tournament._id, playerId: player._id, isActive: true },
            { $inc: inc },
            { returnDocument: 'after' }
        );

        if (!tp) {
            skippedCount++;
            skippedLog.push(`${player.name} is not active in ${tournament.tournamentKey}`);
            continue;
        }

        // ── Update all-time user profile (upsert) ──
        await UserProfile.findOneAndUpdate(
            { guildId: guild.id, discordID },
            {
                $setOnInsert: { guildId: guild.id, discordID },
                $set: { displayName: player.name },
                $inc: {
                    'allTimeStats.goals': goals,
                    'allTimeStats.assists': assists,
                    'allTimeStats.interceptions': interceptions,
                    'allTimeStats.tackles': tackles,
                    'allTimeStats.saves': saves,
                    'allTimeStats.played': countPlayed ? 1 : 0
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        // ── Track totals ──
        processedCount++;
        totals.goals += goals;
        totals.assists += assists;
        totals.interceptions += interceptions;
        totals.tackles += tackles;
        totals.saves += saves;
        if (countPlayed) totals.played += 1;

        successLog.push(
            `${player.name}: ${buildStatString({ goals, assists, interceptions, tackles, saves, countPlayed })}`
        );
    }

    // ── Refresh live top stats ──
    await updateLiveTopStats(client, guild.id, tournament.tournamentKey).catch(console.error);

    if (global.io) {
        global.io.emit('update');
    }

    // ── DM detailed report to organizer ──
    const dmEmbed = new EmbedBuilder()
        .setColor(processedCount > 0 ? 0x2ECC71 : 0xE74C3C)
        .setTitle('📊 Stats Update Details')
        .setDescription(
            `Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Processed: **${processedCount}**\n` +
            `Skipped: **${skippedCount}**`
        )
        .addFields(
            {
                name: 'Totals Added',
                value:
                    `⚽ Goals: **${totals.goals}**\n` +
                    `🎯 Assists: **${totals.assists}**\n` +
                    `🧠 Interceptions: **${totals.interceptions}**\n` +
                    `⚔️ Tackles: **${totals.tackles}**\n` +
                    `🧤 Saves: **${totals.saves}**\n` +
                    `🏟️ Played: **${totals.played}**`,
                inline: false
            },
            {
                name: 'Updated Players',
                value: successLog.length ? successLog.slice(0, 35).join('\n') : 'No stats were updated.',
                inline: false
            },
            {
                name: 'Skipped',
                value: skippedLog.length ? skippedLog.slice(0, 20).join('\n') : 'None',
                inline: false
            }
        )
        .setFooter({ text: `${tournament.name} • ${tournament.tournamentKey}` })
        .setTimestamp();

    await organizerUser.send({ embeds: [dmEmbed] }).catch(() => null);

    // ── Brief in-channel confirmation ──
    return respondFinal({ content: '✅ Stats Updated', embeds: [] });
}

/* ====================================================
   PARSING HELPERS
==================================================== */

/**
 * Parse a single CSV stats line.
 * Format: discordID, goals, assists, interceptions, tackles, saves
 */
function parseRawStatLine(line) {
    const parts = line.split(',').map(part => part.trim());

    if (parts.length < 6) {
        return { ok: false };
    }

    const [rawId, rawGoals, rawAssists, rawInterceptions, rawTackles, rawSaves] = parts;
    const discordID = rawId.replace(/[<@!>]/g, '');

    if (!/^\d{17,20}$/.test(discordID)) {
        return { ok: false };
    }

    return {
        ok: true,
        data: {
            discordID,
            goals: safeInt(rawGoals),
            assists: safeInt(rawAssists),
            interceptions: safeInt(rawInterceptions),
            tackles: safeInt(rawTackles),
            saves: safeInt(rawSaves)
        }
    };
}

/**
 * Parse an integer, returning 0 for NaN.
 */
function safeInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Build a compact stat display string for the DM report.
 */
function buildStatString({ goals, assists, interceptions, tackles, saves, countPlayed }) {
    const chunks = [];

    if (goals > 0) chunks.push(`${goals}⚽`);
    if (assists > 0) chunks.push(`${assists}🎯`);
    if (interceptions > 0) chunks.push(`${interceptions}🧠`);
    if (tackles > 0) chunks.push(`${tackles}⚔️`);
    if (saves > 0) chunks.push(`${saves}🧤`);
    if (countPlayed) chunks.push('+1🏟️');

    return chunks.length ? chunks.join(' ') : '✅';
}
