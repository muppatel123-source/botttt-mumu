const {
    EmbedBuilder,
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    UserProfile
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getTournamentByKey
} = require('../../utils/getTournament');

const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'addstats',
    description: 'Bulk add raw handfootball player stats.',
    usage: '.addstats [tournamentKey] or reply to raw stats message with .as [tournamentKey]',
    aliases: ['as'],
    hidden: true,
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

            const rawData = await getRawStatsFromMessage(
                message,
                args,
                firstArgIsKey
            );

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
            console.error('addstats.js prefix error:', error);
            return message.reply('❌ Failed to process raw stats.');
        }
    },

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
            console.error('addstats.js slash error:', error);

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

async function resolveTournament(guildId, key) {
    if (key) {
        const found = await getTournamentByKey(guildId, key, {
            includeCompleted: true
        });

        if (found) return found;
    }

    return getDefaultTournament(guildId, {
        includeCompleted: true
    });
}

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

async function processStats({
    client,
    guild,
    tournament,
    rawData,
    countPlayed,
    organizerUser,
    respondFinal
}) {
    const lines = rawData
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

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

        const {
            discordID,
            goals,
            assists,
            interceptions,
            tackles,
            saves
        } = parsed.data;

        const player = await Player.findOne({
            guildId: guild.id,
            discordID
        });

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

        if (countPlayed) {
            inc['stats.played'] = 1;
        }

        const tp = await TournamentPlayer.findOneAndUpdate(
            {
                guildId: guild.id,
                tournamentId: tournament._id,
                playerId: player._id,
                isActive: true
            },
            {
                $inc: inc
            },
            {
                returnDocument: 'after'
            }
        );

        if (!tp) {
            skippedCount++;
            skippedLog.push(`${player.name} is not active in ${tournament.tournamentKey}`);
            continue;
        }

        await UserProfile.findOneAndUpdate(
            {
                guildId: guild.id,
                discordID
            },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    discordID
                },
                $set: {
                    displayName: player.name
                },
                $inc: {
                    'allTimeStats.goals': goals,
                    'allTimeStats.assists': assists,
                    'allTimeStats.interceptions': interceptions,
                    'allTimeStats.tackles': tackles,
                    'allTimeStats.saves': saves,
                    'allTimeStats.played': countPlayed ? 1 : 0
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        processedCount++;

        totals.goals += goals;
        totals.assists += assists;
        totals.interceptions += interceptions;
        totals.tackles += tackles;
        totals.saves += saves;
        if (countPlayed) totals.played += 1;

        successLog.push(
            `${player.name}: ${buildStatString({
                goals,
                assists,
                interceptions,
                tackles,
                saves,
                countPlayed
            })}`
        );
    }

    await updateLiveTopStats(
        client,
        guild.id,
        tournament.tournamentKey
    ).catch(console.error);

    if (global.io) {
        global.io.emit('update');
    }

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
                value: successLog.length
                    ? successLog.slice(0, 35).join('\n')
                    : 'No stats were updated.',
                inline: false
            },
            {
                name: 'Skipped',
                value: skippedLog.length
                    ? skippedLog.slice(0, 20).join('\n')
                    : 'None',
                inline: false
            }
        )
        .setFooter({ text: `${tournament.name} • ${tournament.tournamentKey}` })
        .setTimestamp();

    await organizerUser.send({ embeds: [dmEmbed] }).catch(() => null);

    return respondFinal({
        content: '✅ Stats Updated',
        embeds: []
    });
}

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

function safeInt(value) {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function buildStatString({
    goals,
    assists,
    interceptions,
    tackles,
    saves,
    countPlayed
}) {
    const chunks = [];

    if (goals > 0) chunks.push(`${goals}⚽`);
    if (assists > 0) chunks.push(`${assists}🎯`);
    if (interceptions > 0) chunks.push(`${interceptions}🧠`);
    if (tackles > 0) chunks.push(`${tackles}⚔️`);
    if (saves > 0) chunks.push(`${saves}🧤`);
    if (countPlayed) chunks.push(`+1🏟️`);

    return chunks.length ? chunks.join(' ') : '✅';
}
