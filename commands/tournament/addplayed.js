const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Team } = require('../../models/Tournament');

const ORGANIZER_IDS = [
    '860525870804631592',
    '1487768789570556064',
    '856556430370930738'
];

function isOrganizer(userId) {
    return ORGANIZER_IDS.includes(userId);
}

module.exports = {
    name: 'addplayed',
    description: 'Manually add played matches to team stats.',
    usage: '.addplayed <team name> <count>',
    aliases: ['manualplayed'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.ManageGuild],

    data: new SlashCommandBuilder()
        .setName('addplayed')
        .setDescription('Manually add played matches to team stats')
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('count')
                .setDescription('Number of played matches to add')
                .setRequired(true)
                .setMinValue(1)
        ),

    async execute(message, args) {
        try {

            if (!isOrganizer(message.author.id)) {
            return message.reply('🚫 You are not authorized to use this command.');
        }

            const count = parseInt(args[args.length - 1], 10);
            const teamName = args.slice(0, -1).join(' ').trim();

            if (!teamName || Number.isNaN(count)) {
                return message.reply('❌ Usage: `.addplayed <team name> <count>`');
            }

            return await runAddPlayed({
                guild: message.guild,
                teamName,
                count,
                reply: (payload) => message.reply(payload)
            });
        } catch (error) {
            console.error('addplayed.js prefix error:', error);
            return message.reply('❌ Failed to update played count.');
        }
    },

    async slashExecute(interaction) {
        try {

            if (!isOrganizer(interaction.user.id)) {
            return interaction.reply({
                content: '🚫 You are not authorized to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

            return await runAddPlayed({
                guild: interaction.guild,
                teamName: interaction.options.getString('team'),
                count: interaction.options.getInteger('count'),
                reply: (payload) => interaction.reply({ ...payload, ephemeral: true })
            });
        } catch (error) {
            console.error('addplayed.js slash error:', error);
            if (interaction.replied || interaction.deferred) {
                return interaction.editReply({ content: '❌ Failed to update played count.' });
            }
            return interaction.reply({ content: '❌ Failed to update played count.', ephemeral: true });
        }
    }
};

async function runAddPlayed({ guild, teamName, count, reply }) {
    if (!guild) return reply({ content: '❌ This command can only be used in a server.' });

    const team = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (!team) {
        return reply({ content: `❌ Team not found: \`${teamName}\`` });
    }

    await Team.updateOne(
        { _id: team._id },
        { $inc: { 'stats.played': count } }
    );

    const refreshed = await Team.findById(team._id);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('➕ PLAYED COUNT UPDATED')
        .setDescription(
            `**${refreshed.name}** played count increased by **${count}**.\n` +
            `New Played: **${refreshed.stats?.played || 0}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

function escapeRegex(text) {
    return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}