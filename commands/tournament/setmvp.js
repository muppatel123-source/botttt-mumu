/**
 * setmvp.js
 *
 * Add MVP award(s) to player(s). Supports Tournaments + Freestyle Events.
 * Organizers can reply to a MOTM message.
 *
 * Usage:  .setmvp [tournamentKey/eventKey] @user OR reply to MOTM message with .sm [key]
 * Alias: sm
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    EventPlayer,
    UserProfile
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getTournamentByKey
} = require('../../utils/getTournament');

const {
    getEventByKey,
    getEventByChannel
} = require('../../utils/getEvent');

const { ensurePlayer } = require('../../utils/playerHelpers');
const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setmvp',
    description: 'Add MVP award(s) to player(s) (tournaments + events).',
    usage: '.setmvp [tournamentKey/eventKey] @user OR reply to MOTM message with .sm [key]',
    aliases: ['sm'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setmvp')
        .setDescription('Add MVP award(s) to player(s)')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament or event key (UCL etc)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('players')
                .setDescription('Mention one or more users')
                .setRequired(false)
        ),


    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const possibleKey = args[0]?.toLowerCase() || null;

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

            const firstArgIsKey =
                possibleKey &&
                (tournamentByKey?.tournamentKey === possibleKey || eventByKey?.eventKey === possibleKey);

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
                const eventByChannel = await getEventByChannel(message.guild.id, message.channel.id);
                if (eventByChannel) {
                    targetType = 'event';
                    targetDoc = eventByChannel;
                } else {
                    const def = await getDefaultTournament(message.guild.id, { includeCompleted: true });
                    if (def) {
                        targetType = 'tournament';
                        targetDoc = def;
                    }
                }
            }

            if (!targetDoc) {
                return message.reply(
                    '❌ No tournament or event found. Set default tournament, bind event with `.setevent <key>` in this channel, or use `.sm <key> @user`.'
                );
            }

            if (targetType === 'event' && targetDoc.isActive === false) {
                return message.reply(`🔒 Event \`${targetDoc.eventKey}\` (**${targetDoc.name}**) is **closed**. No new MVPs allowed. Reopen with \`.setevent open ${targetDoc.eventKey}\`.`);
            }

            const userIds = await getMvpUserIds(
                message,
                args,
                firstArgIsKey
            );

            if (!userIds.length) {
                return message.reply(
                    '❌ Reply to MOTM message with `.sm [key]` or use `.sm [key] @user`.'
                );
            }

            if (targetType === 'event') {
                return await runSetMVPEvent({
                    client: message.client,
                    guild: message.guild,
                    event: targetDoc,
                    userIds,
                    organizerUser: message.author,
                    reply: payload => message.reply(payload)
                });
            } else {
                return await runSetMVPTournament({
                    client: message.client,
                    guild: message.guild,
                    tournament: targetDoc,
                    userIds,
                    organizerUser: message.author,
                    reply: payload => message.reply(payload)
                });
            }

        } catch (error) {
            console.error('[setmvp] prefix error:', error);
            return message.reply('❌ Failed to add MVP(s).');
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
            const raw = interaction.options.getString('players') || '';
            const ids = extractUserIds(raw);

            if (!ids.length) {
                return interaction.editReply('❌ Mention at least one valid user.');
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
                const eventByChannel = await getEventByChannel(interaction.guild.id, interaction.channel.id);
                if (eventByChannel) {
                    targetType = 'event';
                    targetDoc = eventByChannel;
                } else {
                    const def = await getDefaultTournament(interaction.guild.id, { includeCompleted: true });
                    if (def) {
                        targetType = 'tournament';
                        targetDoc = def;
                    }
                }
            }

            if (!targetDoc) {
                return interaction.editReply('❌ No tournament or event found. Set default or bind event.');
            }

            if (targetType === 'event' && targetDoc.isActive === false) {
                return interaction.editReply(`🔒 Event \`${targetDoc.eventKey}\` (**${targetDoc.name}**) is **closed**. No new MVPs allowed. Reopen with \`/setevent open ${targetDoc.eventKey}\`.`);
            }

            if (targetType === 'event') {
                return await runSetMVPEvent({
                    client: interaction.client,
                    guild: interaction.guild,
                    event: targetDoc,
                    userIds: ids,
                    organizerUser: interaction.user,
                    reply: payload => interaction.editReply(payload)
                });
            } else {
                return await runSetMVPTournament({
                    client: interaction.client,
                    guild: interaction.guild,
                    tournament: targetDoc,
                    userIds: ids,
                    organizerUser: interaction.user,
                    reply: payload => interaction.editReply(payload)
                });
            }

        } catch (error) {
            console.error('[setmvp] slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to add MVP(s).');
            }

            return interaction.reply({
                content: '❌ Failed to add MVP(s).',
                ephemeral: true
            });
        }
    }
};

async function getMvpUserIds(message, args, firstArgIsKey) {
    const directText = firstArgIsKey
        ? args.slice(1).join(' ')
        : args.join(' ');

    const directIds = extractUserIds(directText);

    if (directIds.length) {
        return [...new Set(directIds)];
    }

    const replied = message.reference?.messageId
        ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
        : null;

    if (!replied) return [];

    const mentionedIds = [...replied.mentions.users.keys()];

    if (mentionedIds.length) {
        return [...new Set(mentionedIds)];
    }

    return [...new Set(extractUserIds(replied.content || ''))];
}

async function runSetMVPTournament({
    client,
    guild,
    tournament,
    userIds,
    organizerUser,
    reply
}) {
    const results = [];

    for (const userId of [...new Set(userIds)]) {
        const player = await Player.findOne({
            guildId: guild.id,
            discordID: userId
        });

        if (!player) {
            results.push(`❌ No global player linked to <@${userId}>`);
            continue;
        }

        const updated = await TournamentPlayer.findOneAndUpdate(
            {
                guildId: guild.id,
                tournamentId: tournament._id,
                playerId: player._id,
                isActive: true
            },
            {
                $inc: {
                    'stats.mvps': 1
                }
            },
            {
                returnDocument: 'after'
            }
        );

        if (!updated) {
            results.push(`❌ ${player.name} is not active in ${tournament.tournamentKey}`);
            continue;
        }

        await UserProfile.findOneAndUpdate(
            {
                guildId: guild.id,
                discordID: userId
            },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    discordID: userId,
                    trophies: [],
                    awards: []
                },
                $set: {
                    displayName: player.name
                },
                $inc: {
                    'allTimeStats.mvps': 1
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        results.push(`✅ ${player.name} — MVPs: ${updated.stats?.mvps || 0}`);
    }

    await updateLiveTopStats(
        client,
        guild.id,
        tournament.tournamentKey
    ).catch(console.error);

    if (global.io) global.io.emit('update');

    const dmEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('👑 MVP Update Details')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            (results.length ? results.join('\n') : 'No MVPs were updated.')
        )
        .setTimestamp();

    await organizerUser.send({ embeds: [dmEmbed] }).catch(() => null);

    return reply({
        content: '✅ Done',
        embeds: []
    });
}

async function runSetMVPEvent({
    client,
    guild,
    event,
    userIds,
    organizerUser,
    reply
}) {
    const results = [];

    for (const userId of [...new Set(userIds)]) {
        const player = await ensurePlayer(guild, userId);

        if (!player) {
            results.push(`❌ Failed to create player for <@${userId}>`);
            continue;
        }

        const updated = await EventPlayer.findOneAndUpdate(
            {
                guildId: guild.id,
                eventId: event._id,
                playerId: player._id
            },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    eventId: event._id,
                    playerId: player._id,
                    isActive: true
                },
                $set: { playerNameSnapshot: player.name },
                $inc: { 'stats.mvps': 1 }
            },
            { upsert: true, returnDocument: 'after' }
        );

        await UserProfile.findOneAndUpdate(
            {
                guildId: guild.id,
                discordID: player.discordID
            },
            {
                $setOnInsert: {
                    guildId: guild.id,
                    discordID: player.discordID
                },
                $set: { displayName: player.name },
                $inc: { 'allTimeStats.mvps': 1 }
            },
            { upsert: true }
        );

        results.push(`✅ ${player.name} — MVPs: ${updated.stats?.mvps || 0} [${event.eventKey}]`);
    }

    if (global.io) global.io.emit('update');

    const dmEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('👑 Event MVP Update')
        .setDescription(
            `${event.emoji || '🏆'} Event: **${event.name}**\n` +
            `Key: \`${event.eventKey}\`\n\n` +
            (results.length ? results.join('\n') : 'No MVPs were updated.')
        )
        .setTimestamp();

    await organizerUser.send({ embeds: [dmEmbed] }).catch(() => null);

    return reply({
        content: `✅ Done — **${event.name}**`,
        embeds: []
    });
}

function extractUserIds(text) {
    return String(text || '').match(/\d{17,20}/g) || [];
}
