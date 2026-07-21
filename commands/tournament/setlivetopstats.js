/**
 * setlivetopstats.js
 *
 * Create a live-updating top stats message for a tournament.
 *
 * Usage: .setlivetopstats [tournamentKey]
 * Slash: /setlivetopstats [key]
 *
 * Aliases: slts, livetopstats
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const LiveMessage = require('../../models/LiveMessage');

const {
    getDefaultTournament,
    getTournamentByKey
} = require('../../utils/getTournament');

const { updateLiveTopStats } = require('../../utils/updateTopStats');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setlivetopstats',
    description: 'Set live top stats message.',
    usage: '.setlivetopstats [tournamentKey]',
    aliases: ['slts', 'livetopstats'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setlivetopstats')
        .setDescription('Create live top stats message')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
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

            const tournament = await resolveTournament(
                message.guild.id,
                args[0]
            );

            if (!tournament) {
                return message.reply('❌ Tournament not found.');
            }

            return await runSetup({
                client: message.client,
                guild: message.guild,
                channel: message.channel,
                tournament,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setlivetopstats] prefix error:', error);
            return message.reply('❌ Failed to create live top stats.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const tournament = await resolveTournament(
                interaction.guild.id,
                interaction.options.getString('key')
            );

            if (!tournament) {
                return interaction.editReply('❌ Tournament not found.');
            }

            return await runSetup({
                client: interaction.client,
                guild: interaction.guild,
                channel: interaction.channel,
                tournament,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setlivetopstats] slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to create live top stats.');
            }

            return interaction.reply({
                content: '❌ Failed to create live top stats.',
                ephemeral: true
            });
        }
    }
};

async function resolveTournament(guildId, key) {
    if (key) {
        const found = await getTournamentByKey(
            guildId,
            key.toLowerCase()
        );

        if (found) return found;
    }

    return getDefaultTournament(guildId);
}

async function runSetup({
    client,
    guild,
    channel,
    tournament,
    reply
}) {
    await LiveMessage.findOneAndDelete({
        guildId: guild.id,
        type: 'topstats',
        tournamentKey: tournament.tournamentKey,
        groupKey: null
    });

    const loading = await channel.send(
        `⏳ Creating live top stats for **${tournament.name}**...`
    );

    await LiveMessage.create({
        guildId: guild.id,
        type: 'topstats',
        tournamentKey: tournament.tournamentKey,
        groupKey: null,
        channelId: channel.id,
        messageId: loading.id
    });

    await updateLiveTopStats(
        client,
        guild.id,
        tournament.tournamentKey
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ LIVE TOP STATS CREATED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `This message will now auto-update.`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}