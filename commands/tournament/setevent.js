/**
 * setevent.js
 *
 * Freestyle event management for daily tracking (e.g. UCL).
 * No teams, no /settournament needed. Channel-bound.
 * .as and .setmvp auto-route to bound event when in that channel.
 *
 * Prefix:
 *   .setevent <eventKey> [eventName]       -> create/bind to current channel
 *   .setevent list                         -> list all events
 *   .setevent remove <eventKey>            -> delete event + stats
 *   .setevent disable                      -> unbind current channel
 *   .setevent disable <eventKey>           -> unbind specific event
 *   .setevent info <eventKey>              -> show event info
 *
 * Slash:
 *   /setevent action:<create|list|remove|disable|info> key:<key> name:<name> channel:<channel>
 *
 * Aliases: event, set-event, eventsetup
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType
} = require('discord.js');

const {
    EventSettings,
    EventPlayer
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { getSelectableEvents, getEventByKey, getEventByChannel } = require('../../utils/getEvent');

module.exports = {
    name: 'setevent',
    description: 'Create/bind freestyle event to current channel for daily stat tracking.',
    usage: '.setevent <eventKey> [eventName] | .setevent list | .setevent remove <key> | .setevent disable',
    aliases: ['event', 'set-event', 'eventsetup'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setevent')
        .setDescription('Manage freestyle events (UCL etc)')
        .addStringOption(opt =>
            opt.setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Create/Bind to channel', value: 'create' },
                    { name: 'List all events', value: 'list' },
                    { name: 'Remove event', value: 'remove' },
                    { name: 'Disable/unbind channel', value: 'disable' },
                    { name: 'Close/end event (keep stats)', value: 'close' },
                    { name: 'Reopen event', value: 'open' },
                    { name: 'Info', value: 'info' }
                )
        )
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Event key, e.g. ucl, ucl-s1')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('name')
                .setDescription('Event display name, e.g. Champions League')
                .setRequired(false)
        )
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to bind (defaults to current)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
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

            if (!args.length) {
                return message.reply(getHelpText());
            }

            const sub = args[0].toLowerCase();

            if (sub === 'list') {
                return await handleList(message.guild, reply => message.reply(reply));
            }

            if (sub === 'remove' || sub === 'delete' || sub === 'del') {
                const key = args[1]?.toLowerCase();
                if (!key) return message.reply('❌ Provide event key: `.setevent remove <key>`');
                return await handleRemove(message.guild, key, reply => message.reply(reply));
            }

            if (sub === 'close' || sub === 'end' || sub === 'archive' || sub === 'finish') {
                const key = args[1]?.toLowerCase();
                if (!key) return message.reply('❌ Provide event key: `.setevent close <key>` — keeps stats but blocks new .as');
                return await handleClose(message.guild, key, reply => message.reply(reply));
            }

            if (sub === 'open' || sub === 'reopen' || sub === 'unclose' || sub === 'reactivate') {
                const key = args[1]?.toLowerCase();
                if (!key) return message.reply('❌ Provide event key: `.setevent open <key>`');
                return await handleOpen(message.guild, key, reply => message.reply(reply));
            }

            if (sub === 'disable' || sub === 'unbind' || sub === 'off') {
                const key = args[1]?.toLowerCase() || null;
                const channelId = message.channel.id;
                return await handleDisable(message.guild, channelId, key, reply => message.reply(reply));
            }

            if (sub === 'info') {
                const key = args[1]?.toLowerCase();
                if (!key) return message.reply('❌ Provide event key: `.setevent info <key>`');
                return await handleInfo(message.guild, key, reply => message.reply(reply));
            }

            // Default: create/bind
            // .setevent <key> [name...]
            const eventKey = normalizeKey(sub);
            if (!isValidKey(eventKey)) {
                return message.reply('❌ Invalid event key. Use 2-40 chars: letters, numbers, dash. Example: `ucl`, `ucl-s1`');
            }

            const eventName = args.slice(1).join(' ').trim() || eventKey.toUpperCase();
            const channelId = message.channel.id;

            return await handleCreate({
                guild: message.guild,
                eventKey,
                eventName,
                channelId,
                createdBy: message.author.id,
                reply: payload => message.reply(payload)
            });

        } catch (error) {
            console.error('[setevent] prefix error:', error);
            return message.reply('❌ Failed to manage event.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 You are not authorized to use this command.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const action = interaction.options.getString('action');
            const key = interaction.options.getString('key')?.toLowerCase() || null;
            const name = interaction.options.getString('name') || null;
            const channelOpt = interaction.options.getChannel('channel');
            const channelId = channelOpt?.id || interaction.channel.id;

            if (action === 'list') {
                return await handleList(interaction.guild, payload => interaction.editReply(payload));
            }

            if (action === 'remove') {
                if (!key) return interaction.editReply('❌ Provide event key to remove.');
                return await handleRemove(interaction.guild, key, payload => interaction.editReply(payload));
            }

            if (action === 'close') {
                if (!key) return interaction.editReply('❌ Provide event key to close.');
                return await handleClose(interaction.guild, key, payload => interaction.editReply(payload));
            }

            if (action === 'open') {
                if (!key) return interaction.editReply('❌ Provide event key to reopen.');
                return await handleOpen(interaction.guild, key, payload => interaction.editReply(payload));
            }

            if (action === 'disable') {
                return await handleDisable(interaction.guild, channelId, key, payload => interaction.editReply(payload));
            }

            if (action === 'info') {
                if (!key) return interaction.editReply('❌ Provide event key for info.');
                return await handleInfo(interaction.guild, key, payload => interaction.editReply(payload));
            }

            if (action === 'create') {
                if (!key) return interaction.editReply('❌ Provide event key. Example: `ucl`');
                if (!isValidKey(key)) return interaction.editReply('❌ Invalid key. Use 2-40 chars, letters/numbers/dash.');

                return await handleCreate({
                    guild: interaction.guild,
                    eventKey: normalizeKey(key),
                    eventName: name || key.toUpperCase(),
                    channelId,
                    createdBy: interaction.user.id,
                    reply: payload => interaction.editReply(payload)
                });
            }

            return interaction.editReply('❌ Unknown action.');

        } catch (error) {
            console.error('[setevent] slash error:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to manage event.');
            }
            return interaction.reply({ content: '❌ Failed to manage event.', ephemeral: true });
        }
    }
};

/* ====================================================
   HANDLERS
==================================================== */

async function handleCreate({ guild, eventKey, eventName, channelId, createdBy, reply }) {
    // Unbind any other event currently bound to this channel (only one event per channel)
    const existingBound = await EventSettings.find({ guildId: guild.id, channelId });

    if (existingBound.length) {
        // If same key already bound, we will just update it, so exclude it from unbind list
        const toUnbind = existingBound.filter(e => e.eventKey !== eventKey);

        if (toUnbind.length) {
            await EventSettings.updateMany(
                { guildId: guild.id, channelId, eventKey: { $ne: eventKey } },
                { $set: { channelId: '' } }
            );
        }
    }

    const event = await EventSettings.findOneAndUpdate(
        { guildId: guild.id, eventKey },
        {
            $set: {
                guildId: guild.id,
                eventKey,
                name: eventName,
                channelId,
                isActive: true,
                createdBy
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const playerCount = await EventPlayer.countDocuments({ guildId: guild.id, eventId: event._id });

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Event Bound')
        .setDescription(
            `**Key:** \`${event.eventKey}\`\n` +
            `**Name:** ${event.name}\n` +
            `**Channel:** <#${channelId}>\n` +
            `**Players tracked:** ${playerCount}\n\n` +
            `Now whenever you run \`.as\` or \`.setmvp\` in <#${channelId}>, stats will go to **${event.name}**.\n` +
            `Visible in \`.mystats\` and \`.topstats\` dropdown as \`[EVENT] ${event.name}\`.`
        )
        .setFooter({ text: `Event: ${event.eventKey} • ${guild.name}` })
        .setTimestamp();

    if (existingBound.length && existingBound.some(e => e.eventKey !== eventKey)) {
        embed.addFields({
            name: 'ℹ️ Previous binding cleared',
            value: `Unbound: ${existingBound.filter(e => e.eventKey !== eventKey).map(e => `\`${e.eventKey}\``).join(', ')} from <#${channelId}>`
        });
    }

    return reply({ embeds: [embed] });
}

async function handleList(guild, reply) {
    const events = await getSelectableEvents(guild.id);

    if (!events.length) {
        return reply({ content: '📭 No events found. Create one with `.setevent <key> [name]` in the target channel.' });
    }

    const lines = events.map(e => {
        const ch = e.channelId ? `<#${e.channelId}>` : '`not bound`';
        let status = '🟢 ACTIVE';
        if (!e.isActive) status = '🔴 CLOSED';
        else if (!e.channelId) status = '🟡 UNBOUND';
        return `${status} \`${e.eventKey}\` — **${e.name}** → ${ch}`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📋 Freestyle Events')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: `${events.length} event(s) • .setevent <key> [name] to create/bind • close keeps stats` })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function handleClose(guild, eventKey, reply) {
    const event = await getEventByKey(guild.id, eventKey);

    if (!event) {
        return reply({ content: `❌ Event \`${eventKey}\` not found.` });
    }

    if (!event.isActive) {
        return reply({ content: `ℹ️ Event \`${event.eventKey}\` is already closed. Stats are kept. Use \`.setevent open ${event.eventKey}\` to reopen.` });
    }

    const oldChannel = event.channelId;

    await EventSettings.updateOne(
        { _id: event._id },
        { $set: { isActive: false, channelId: '' } }
    );

    const playerCount = await EventPlayer.countDocuments({ guildId: guild.id, eventId: event._id });

    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('🔒 Event Closed')
        .setDescription(
            `**Key:** \`${event.eventKey}\`\n` +
            `**Name:** ${event.name}\n` +
            `**Previous Channel:** ${oldChannel ? `<#${oldChannel}>` : '`not bound`'}\n` +
            `**Players:** ${playerCount}\n\n` +
            `✅ Stats are **kept** and still visible in \`.mystats\` / \`.topstats\`.\n` +
            `🚫 No more \`.as\` / \`.setmvp\` will be accepted for this event (even with explicit key) until reopened.\n` +
            `Channel <#${oldChannel || 'unknown'}> is now free for a new event.`
        )
        .setFooter({ text: `Use .setevent open ${event.eventKey} to reopen • .setevent remove ${event.eventKey} to delete` })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function handleOpen(guild, eventKey, reply) {
    const event = await getEventByKey(guild.id, eventKey);

    if (!event) {
        return reply({ content: `❌ Event \`${eventKey}\` not found.` });
    }

    if (event.isActive) {
        return reply({ content: `ℹ️ Event \`${event.eventKey}\` is already active ${event.channelId ? `in <#${event.channelId}>` : '(unbound, bind with .setevent)'} .` });
    }

    await EventSettings.updateOne(
        { _id: event._id },
        { $set: { isActive: true } }
    );

    const playerCount = await EventPlayer.countDocuments({ guildId: guild.id, eventId: event._id });

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔓 Event Reopened')
        .setDescription(
            `**Key:** \`${event.eventKey}\`\n` +
            `**Name:** ${event.name}\n` +
            `**Players:** ${playerCount}\n\n` +
            `✅ Event is active again. It will accept \`.as\` / \`.setmvp\` when bound to a channel.\n` +
            `Run \`.setevent ${event.eventKey}\` in the target channel to bind it.`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function handleRemove(guild, eventKey, reply) {
    const event = await getEventByKey(guild.id, eventKey);

    if (!event) {
        return reply({ content: `❌ Event \`${eventKey}\` not found.` });
    }

    const playerCount = await EventPlayer.countDocuments({ guildId: guild.id, eventId: event._id });

    await EventPlayer.deleteMany({ guildId: guild.id, eventId: event._id });
    await EventSettings.deleteOne({ _id: event._id });

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🗑️ Event Removed')
        .setDescription(
            `**Key:** \`${event.eventKey}\`\n` +
            `**Name:** ${event.name}\n` +
            `Deleted **${playerCount}** player stat records.`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function handleDisable(guild, channelId, eventKey, reply) {
    if (eventKey) {
        // Disable specific event
        const event = await getEventByKey(guild.id, eventKey);
        if (!event) return reply({ content: `❌ Event \`${eventKey}\` not found.` });

        await EventSettings.updateOne({ _id: event._id }, { $set: { channelId: '' } });

        return reply({ content: `✅ Unbound \`${event.eventKey}\` (${event.name}) from <#${event.channelId || channelId}>. It will no longer auto-capture .as in that channel.` });
    }

    // Disable whatever is bound to this channel
    const bound = await getEventByChannel(guild.id, channelId);

    if (!bound) {
        return reply({ content: `📭 No event is currently bound to <#${channelId}>.` });
    }

    await EventSettings.updateOne({ _id: bound._id }, { $set: { channelId: '' } });

    return reply({ content: `✅ Unbound \`${bound.eventKey}\` (${bound.name}) from <#${channelId}>.` });
}

async function handleInfo(guild, eventKey, reply) {
    const event = await getEventByKey(guild.id, eventKey);

    if (!event) {
        return reply({ content: `❌ Event \`${eventKey}\` not found.` });
    }

    const playerCount = await EventPlayer.countDocuments({ guildId: guild.id, eventId: event._id });
    const topPlayers = await EventPlayer.find({ guildId: guild.id, eventId: event._id })
        .sort({ 'stats.goals': -1 })
        .limit(5)
        .populate('playerId')
        .lean();

    const topLines = topPlayers.length
        ? topPlayers.map((ep, i) => `${i + 1}. ${ep.playerNameSnapshot || ep.playerId?.name || 'Unknown'} — ${ep.stats?.goals || 0}⚽ ${ep.stats?.assists || 0}🎯 ${ep.stats?.played || 0}🏟️`).join('\n')
        : 'No stats yet.';

    const status = !event.isActive ? '🔴 CLOSED (stats kept, no new .as)' : event.channelId ? '🟢 ACTIVE' : '🟡 UNBOUND';

    const embed = new EmbedBuilder()
        .setColor(!event.isActive ? 0x95A5A6 : 0xF1C40F)
        .setTitle(`ℹ️ Event Info — ${event.name}`)
        .setDescription(
            `**Key:** \`${event.eventKey}\`\n` +
            `**Name:** ${event.name}\n` +
            `**Status:** ${status}\n` +
            `**Channel:** ${event.channelId ? `<#${event.channelId}>` : '`not bound`'}\n` +
            `**Players:** ${playerCount}\n` +
            `**Created:** <t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:R>\n\n` +
            `**Top Scorers:**\n${topLines}\n\n` +
            (event.isActive
                ? `To close (keep stats): \`.setevent close ${event.eventKey}\``
                : `To reopen: \`.setevent open ${event.eventKey}\` • To delete: \`.setevent remove ${event.eventKey}\``)
        )
        .setFooter({ text: `Use .setevent ${event.eventKey} in a channel to bind` })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   HELPERS
==================================================== */

function normalizeKey(key) {
    return String(key || '').trim().toLowerCase();
}

function isValidKey(key) {
    return /^[a-z0-9-]{2,40}$/.test(key);
}

function getHelpText() {
    return (
        '**Usage:**\n' +
        '`.setevent <eventKey> [eventName]` — Create/bind event to current channel\n' +
        '`.setevent list` — List all events\n' +
        '`.setevent info <key>` — Show event info\n' +
        '`.setevent close <key>` — Close/end event, keep stats, block new .as\n' +
        '`.setevent open <key>` — Reopen closed event\n' +
        '`.setevent remove <key>` — Delete event + stats (permanent)\n' +
        '`.setevent disable` — Unbind event from current channel (keeps active)\n\n' +
        '**Example:**\n' +
        '`.setevent ucl Champions League` in #ucl-matches\n' +
        'Then `.as` in that channel auto-updates UCL stats.\n' +
        'When UCL ends: `.setevent close ucl` — stats stay in mystats/topstats but no more updates.'
    );
}
