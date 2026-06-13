/**
 * setuclqualification.js
 *
 * Set the number of league UCL qualification spots for a tournament.
 * Organizer only.
 *
 * Usage:  .setuclqualification <tournamentKey> <spots>
 * Slash:  /setuclqualification tournament:<key> spots:<number>
 *
 * Aliases: setucl, uclspots
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { TournamentSettings } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setuclqualification',
    description: 'Set league UCL qualification spots.',
    usage: '.setuclqualification <tournamentKey> <spots>',
    aliases: ['setucl', 'uclspots'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setuclqualification')
        .setDescription('Set league UCL qualification spots')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('spots')
                .setDescription('Number of UCL spots')
                .setRequired(true)
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

            const tournamentKey = args[0]?.toLowerCase();
            const spots = Number(args[1]);

            if (!tournamentKey || Number.isNaN(spots) || spots < 0) {
                return message.reply(
                    '❓ Usage: `.setuclqualification <tournamentKey> <spots>`'
                );
            }

            return await runUpdateUclQualification({
                guildId: message.guild.id,
                tournamentKey,
                spots,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setuclqualification] prefix error:', error);
            return message.reply('❌ Failed to update UCL qualification.');
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

            const tournamentKey = interaction.options.getString('tournament').toLowerCase();
            const spots = interaction.options.getInteger('spots');

            return await runUpdateUclQualification({
                guildId: interaction.guild.id,
                tournamentKey,
                spots,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setuclqualification] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to update UCL qualification.');
            }

            return interaction.reply({
                content: '❌ Failed to update UCL qualification.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runUpdateUclQualification({ guildId, tournamentKey, spots, reply }) {
    const tournament = await TournamentSettings.findOneAndUpdate(
        { guildId, tournamentKey },
        { $set: { uclQualificationSpots: spots } },
        { new: true }
    );

    if (!tournament) {
        return reply({ content: `❌ Tournament \`${tournamentKey}\` not found.` });
    }

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🔵 UCL QUALIFICATION UPDATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n\n` +
            `League UCL Qualification Spots: **${spots}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
