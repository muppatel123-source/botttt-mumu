const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
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
    name: 'setmvp',
    description: 'Add MVP award(s) to player(s).',
    usage: '.setmvp [tournamentKey] @user OR reply to MOTM message with .sm [tournamentKey]',
    aliases: ['sm'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setmvp')
        .setDescription('Add MVP award(s) to player(s)')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('players')
                .setDescription('Mention one or more users')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const possibleKey = args[0]?.toLowerCase() || null;
            const tournament = await resolveTournament(message.guild.id, possibleKey);

            if (!tournament) {
                return message.reply(
                    '❌ Tournament not found. Set a default tournament or use `.sm <tournamentKey>`.'
                );
            }

            const firstArgIsKey =
                possibleKey &&
                possibleKey === tournament.tournamentKey;

            const userIds = await getMvpUserIds(
                message,
                args,
                firstArgIsKey
            );

            if (!userIds.length) {
                return message.reply(
                    '❌ Reply to MOTM message with `.sm [tournamentKey]` or use `.sm [tournamentKey] @user`.'
                );
            }

            return await runSetMVP({
                client: message.client,
                guild: message.guild,
                tournament,
                userIds,
                organizerUser: message.author,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('setmvp prefix error:', error);
            return message.reply('❌ Failed to add MVP(s).');
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
                return interaction.editReply(
                    '❌ Tournament not found. Set a default tournament or provide a valid key.'
                );
            }

            const raw = interaction.options.getString('players') || '';
            const ids = extractUserIds(raw);

            if (!ids.length) {
                return interaction.editReply('❌ Mention at least one valid user.');
            }

            return await runSetMVP({
                client: interaction.client,
                guild: interaction.guild,
                tournament,
                userIds: ids,
                organizerUser: interaction.user,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('setmvp slash error:', error);

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

async function runSetMVP({
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

    if (global.io) {
        global.io.emit('update');
    }

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

function extractUserIds(text) {
    return String(text || '').match(/\d{17,20}/g) || [];
}
