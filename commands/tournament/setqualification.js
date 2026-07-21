/**
 * setqualification.js
 *
 * Set the number of qualification spots for a tournament.
 * For groups_knockout: spots per group.
 * For club_world_cup: spots per group AND spots from Super 8 to semis.
 * Organizer only.
 *
 * Usage:  .setqualification <tournamentKey> <spots> [super8spots]
 * Slash:  /setqualification tournament:<key> spots:<number> [super8spots:<number>]
 *
 * Aliases: setq, setqualify
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { TournamentSettings } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setqualification',
    description: 'Set qualification spots.',
    usage: '.setqualification <tournamentKey> <spots> [super8spots]',
    aliases: ['setq', 'setqualify'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setqualification')
        .setDescription('Set qualification spots')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('spots')
                .setDescription('Qualification spots per group')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('super8spots')
                .setDescription('Club World Cup: spots from Super 8 to semis (default 4)')
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

            const tournamentKey = args[0]?.toLowerCase();
            const spots = Number(args[1]);
            const super8spots = args[2] ? Number(args[2]) : undefined;

            if (!tournamentKey || !spots || spots < 1) {
                return message.reply(
                    '❓ Usage: `.setqualification <tournamentKey> <spots> [super8spots]`'
                );
            }

            return await runUpdateQualification({
                guildId: message.guild.id,
                tournamentKey,
                spots,
                super8spots,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setqualification] prefix error:', error);
            return message.reply('❌ Failed to update qualification spots.');
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
            const super8spots = interaction.options.getInteger('super8spots') ?? undefined;

            return await runUpdateQualification({
                guildId: interaction.guild.id,
                tournamentKey,
                spots,
                super8spots,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setqualification] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to update qualification spots.');
            }

            return interaction.reply({
                content: '❌ Failed to update qualification spots.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runUpdateQualification({ guildId, tournamentKey, spots, super8spots, reply }) {
    const tournament = await TournamentSettings.findOne({ guildId, tournamentKey });

    if (!tournament) {
        return reply({ content: `❌ Tournament \`${tournamentKey}\` not found.` });
    }

    // Club World Cup format
    if (tournament.formatType === 'club_world_cup') {
        tournament.qualificationSpotsPerGroup = spots;
        if (super8spots !== undefined) {
            tournament.super8QualificationSpots = super8spots;
        }

        // Derive knockout rounds from super8 spots
        const s8spots = tournament.super8QualificationSpots || 4;
        tournament.knockoutRounds = deriveKnockoutRounds(s8spots);
        tournament.hasKnockout = true;

        await tournament.save();

        const roundsStr = tournament.knockoutRounds.length
            ? tournament.knockoutRounds.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' → ')
            : 'None';

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('QUALIFICATION UPDATED')
            .setDescription(
                `Tournament: **${tournament.name}**\n\n` +
                `Qualify from each group to Super 8: **${spots}**\n` +
                `Qualify from Super 8 to Knockout: **${s8spots}**\n` +
                `Knockout rounds: **${roundsStr}**`
            )
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    // Standard groups_knockout format
    tournament.qualificationSpotsPerGroup = spots;

    if (tournament.groupCount > 0) {
        const qualifiedCount = tournament.groupCount * spots;
        tournament.knockoutRounds = deriveKnockoutRounds(qualifiedCount);
        tournament.hasKnockout = true;
    }

    await tournament.save();

    const qualifiedCount = tournament.groupCount * spots;
    const roundsStr = tournament.knockoutRounds.length
        ? tournament.knockoutRounds.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' → ')
        : 'None';

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('QUALIFICATION UPDATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n\n` +
            `Teams qualifying from each group: **${spots}**\n` +
            `Total qualified: **${qualifiedCount}**\n` +
            `Knockout rounds: **${roundsStr}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/**
 * Derive knockout rounds from qualified team count.
 * 2 → ['final'], 4 → ['semifinal','final'], 8 → ['quarterfinal','semifinal','final'], etc.
 */
function deriveKnockoutRounds(qualifiedTeamCount) {
    const ALL_ROUNDS = ['roundof16', 'quarterfinal', 'semifinal', 'final'];
    const total = Math.max(2, qualifiedTeamCount);
    const roundedCount = Math.ceil(Math.log2(total));
    return ALL_ROUNDS.slice(ALL_ROUNDS.length - roundedCount);
}
