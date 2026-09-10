/**
 * addstats.js
 *
 * Bulk add raw handfootball player stats from CSV data.
 * Supports both Tournaments and Freestyle Events (UCL etc).
 * - If channel is bound to an event (via .setevent), .as auto-routes to event when no key given.
 * - If explicit key matches event, updates event stats.
 * - Otherwise tournament flow (default tournament fallback).
 *
 * Input format (per line):
 *   discordID, goals, assists, interceptions, tackles, saves
 *
 * Usage: .as [tournamentKey/eventKey] (reply to stats message)
 *        .as [tournamentKey/eventKey] <pasted lines>
 * Slash: /addstats key:<key> data:<lines> count_played:<bool>
 *
 * Aliases: as
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const { Player, TournamentPlayer, EventPlayer, UserProfile } = require('../../models/Tournament');
const { getDefaultTournament, getTournamentByKey } = require('../../utils/getTournament');
const { getEventByKey, getEventByChannel } = require('../../utils/getEvent');
const { ensurePlayer } = require('../../utils/playerHelpers');
const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'addstats',
    description: 'Bulk add raw handfootball player stats (tournaments + events).',
    usage: '.addstats [tournamentKey/eventKey] or reply to raw stats message with .as [key]',
    aliases: ['as'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('addstats')
        .setDescription('Bulk add raw handfootball player stats')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament or event key (UCL, league-s1, etc)')
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

            const possibleKey = args[0]?.toLowerCase() || null;

            // Resolve both tournament and event for the possible key
            let tournamentByKey = null;
            let eventByKey = null;

            if (possibleKey) {
                const [t, e] = await Promise.all([
                    getTournamentByKey(message.guild.id, possibleKey, { includeCompleted: true }),
                    getEventByKey(message.guild.id, possibleKey)
                ]);
                tournamentByKey = t;
                eventByKey = e;
            }

            const firstArgIsKey = Boolean(
                possibleKey &&
                (tournamentByKey?.tournamentKey === possibleKey || eventByKey?.eventKey === possibleKey)
            );

            // Determine target: explicit key > channel-bound event > default tournament
            let targetType = null;
            let targetDoc = null;

            if (firstArgIsKey) {
                if (tournamentByKey) {
                    targetType = 'tournament';
                    targetDoc = tournamentByKey;
                } else if (eventByKey) {
                    targetType = 'event';
                    targetDoc = eventByKey;
                }
            } else {
                // No explicit key, check channel binding
                const eventByChannel = await getEventByChannel(message.guild.id, message.channel.id);
                if (eventByChannel) {
                    targetType = 'event';
                    targetDoc = eventByChannel;
                } else {
                    // Fallback to default tournament
                    const defaultTournament = await getDefaultTournament(message.guild.id, { includeCompleted: true });
                    if (defaultTournament) {
                        targetType = 'tournament';
                        targetDoc = defaultTournament;
                    }
                }
            }

            if (!targetDoc) {
                return message.reply('❌ No tournament or event found. Set a default tournament, bind an event with `.setevent <key>` in this channel, or use `.as <key>`.');
            }

            if (targetType === 'event' && targetDoc.isActive === false) {
                return message.reply(`🔒 Event \`${targetDoc.eventKey}\` (**${targetDoc.name}**) is **closed**. Stats are kept but no new \`.as\` allowed. Reopen with \`.setevent open ${targetDoc.eventKey}\`.`);
            }

            const rawData = await getRawStatsFromMessage(message, args, firstArgIsKey);

            if (!rawData) {
                return message.reply(
                    '❓ Reply to the HandFootball raw stats message with `.as` or use `.as <tournamentKey/eventKey>`.'
                );
            }

            const waitMsg = await message.reply(`⏳ Processing raw match stats for **${targetType === 'event' ? targetDoc.name : targetDoc.name}** [${targetType}]...`);

            if (targetType === 'event') {
                return await processEventStats({
                    client: message.client,
                    guild: message.guild,
                    event: targetDoc,
                    rawData,
                    countPlayed: true,
                    organizerUser: message.author,
                    respondFinal: payload => waitMsg.edit(payload)
                });
            } else {
                return await processTournamentStats({
                    client: message.client,
                    guild: message.guild,
                    tournament: targetDoc,
                    rawData,
                    countPlayed: true,
                    organizerUser: message.author,
                    respondFinal: payload => waitMsg.edit(payload)
                });
            }

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
            const rawData = interaction.options.getString('data');
            const countPlayed = interaction.options.getBoolean('count_played') ?? true;

            if (!rawData) {
                return interaction.editReply('❌ Slash version needs pasted data. For reply-based stats, use `.as`.');
            }

            let targetType = null;
            let targetDoc = null;

            if (key) {
                const [t, e] = await Promise.all([
                    getTournamentByKey(interaction.guild.id, key, { includeCompleted: true }),
                    getEventByKey(interaction.guild.id, key)
                ]);

                if (t) {
                    targetType = 'tournament';
                    targetDoc = t;
                } else if (e) {
                    targetType = 'event';
                    targetDoc = e;
                } else {
                    return interaction.editReply(`❌ No tournament or event found with key \`${key}\`.`);
                }
            } else {
                // No key provided, check channel binding
                const eventByChannel = await getEventByChannel(interaction.guild.id, interaction.channel.id);
                if (eventByChannel) {
                    targetType = 'event';
                    targetDoc = eventByChannel;
                } else {
                    const defaultTournament = await getDefaultTournament(interaction.guild.id, { includeCompleted: true });
                    if (defaultTournament) {
                        targetType = 'tournament';
                        targetDoc = defaultTournament;
                    }
                }
            }

            if (!targetDoc) {
                return interaction.editReply('❌ No tournament or event found. Set default tournament or bind event with `/setevent`.');
            }

            if (targetType === 'event' && targetDoc.isActive === false) {
                return interaction.editReply(`🔒 Event \`${targetDoc.eventKey}\` (**${targetDoc.name}**) is **closed**. Stats are kept but no new stats allowed. Reopen with \`/setevent open ${targetDoc.eventKey}\`.`);
            }

            if (targetType === 'event') {
                return await processEventStats({
                    client: interaction.client,
                    guild: interaction.guild,
                    event: targetDoc,
                    rawData,
                    countPlayed,
                    organizerUser: interaction.user,
                    respondFinal: payload => interaction.editReply(payload)
                });
            } else {
                return await processTournamentStats({
                    client: interaction.client,
                    guild: interaction.guild,
                    tournament: targetDoc,
                    rawData,
                    countPlayed,
                    organizerUser: interaction.user,
                    respondFinal: payload => interaction.editReply(payload)
                });
            }

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
   RAW DATA EXTRACTION
==================================================== */

async function getRawStatsFromMessage(message, args, firstArgIsKey) {
    const replied = message.reference?.messageId
        ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
        : null;

    if (replied?.content) {
        return extractRawStatsBlock(replied.content);
    }

    const contentArgs = firstArgIsKey ? args.slice(1) : args;
    if (!contentArgs.length) return '';

    return contentArgs.join(' ');
}

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
   CORE PROCESSING - TOURNAMENT
==================================================== */

async function processTournamentStats({ client, guild, tournament, rawData, countPlayed, organizerUser, respondFinal }) {
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

        const player = await Player.findOne({ guildId: guild.id, discordID });

        if (!player) {
            skippedCount++;
            skippedLog.push(`Player not found: ${discordID}`);
            continue;
        }

        const inc = {
            'stats.goals': goals,
            'stats.assists': assists,
            'stats.interceptions': interceptions,
            'stats.tackles': tackles,
            'stats.saves': saves
        };

        if (countPlayed) inc['stats.played'] = 1;

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

    await updateLiveTopStats(client, guild.id, tournament.tournamentKey).catch(console.error);

    if (global.io) global.io.emit('update');

    const dmEmbed = new EmbedBuilder()
        .setColor(processedCount > 0 ? 0x2ECC71 : 0xE74C3C)
        .setTitle('📊 Tournament Stats Update')
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

    return respondFinal({ content: '✅ Tournament Stats Updated', embeds: [] });
}

/* ====================================================
   CORE PROCESSING - EVENT (FREESTYLE)
==================================================== */

async function processEventStats({ client, guild, event, rawData, countPlayed, organizerUser, respondFinal }) {
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

        // Auto-create player for events
        const player = await ensurePlayer(guild, discordID);

        if (!player) {
            skippedCount++;
            skippedLog.push(`Failed to create player: ${discordID}`);
            continue;
        }

        const inc = {
            'stats.goals': goals,
            'stats.assists': assists,
            'stats.interceptions': interceptions,
            'stats.tackles': tackles,
            'stats.saves': saves
        };

        if (countPlayed) inc['stats.played'] = 1;

        // Upsert EventPlayer - avoid conflict: same field in $setOnInsert and $set
        await EventPlayer.findOneAndUpdate(
            { guildId: guild.id, eventId: event._id, playerId: player._id },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    eventId: event._id,
                    playerId: player._id,
                    isActive: true
                },
                $set: { playerNameSnapshot: player.name },
                $inc: inc
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Update all-time (yes per user choice)
        await UserProfile.findOneAndUpdate(
            { guildId: guild.id, discordID: player.discordID },
            {
                $setOnInsert: { guildId: guild.id, discordID: player.discordID },
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

    if (global.io) global.io.emit('update');

    const dmEmbed = new EmbedBuilder()
        .setColor(processedCount > 0 ? 0x2ECC71 : 0xE74C3C)
        .setTitle('📊 Event Stats Update')
        .setDescription(
            `Event: **${event.name}**\n` +
            `Key: \`${event.eventKey}\`\n` +
            `Channel: ${event.channelId ? `<#${event.channelId}>` : 'Not bound'}\n\n` +
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
        .setFooter({ text: `${event.name} • ${event.eventKey} [EVENT]` })
        .setTimestamp();

    await organizerUser.send({ embeds: [dmEmbed] }).catch(() => null);

    return respondFinal({ content: `✅ Event Stats Updated — **${event.name}**`, embeds: [] });
}

/* ====================================================
   PARSING HELPERS
==================================================== */

function parseRawStatLine(line) {
    const parts = line.split(',').map(part => part.trim());

    if (parts.length < 6) return { ok: false };

    const [rawId, rawGoals, rawAssists, rawInterceptions, rawTackles, rawSaves] = parts;
    const discordID = rawId.replace(/[<@!>]/g, '');

    if (!/^\d{17,20}$/.test(discordID)) return { ok: false };

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

function safeInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

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
