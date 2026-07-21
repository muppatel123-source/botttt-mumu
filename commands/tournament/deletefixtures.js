/**
 * deletefixtures.js
 *
 * Delete fixtures from a tournament with multiple filter modes.
 * Requires explicit confirmation to prevent accidental deletion.
 *
 * Usage:  .deletefixtures [key] mode=<all|phase|round|group|match> value=<...> --confirm
 * Slash:  /deletefixtures mode:<mode> confirm:true [key] [value]
 *
 * Aliases: delfixtures, removefixtures
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Fixture } = require('../../models/Tournament');
const { getDefaultTournament, getTournamentByKey } = require('../../utils/getTournament');
const { isOrganizer } = require('../../utils/isOrganizer');

/** Valid deletion modes. */
const MODES = ['all', 'pending', 'played', 'phase', 'round', 'group', 'match'];

module.exports = {
    name: 'deletefixtures',
    description: 'Delete fixtures from a tournament.',
    usage: '.deletefixtures [key] mode=<all|phase|round|group|match> value=<...> --confirm',
    aliases: ['delfixtures', 'removefixtures'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('deletefixtures')
        .setDescription('Delete fixtures safely')
        .addStringOption(opt =>
            opt.setName('mode')
                .setDescription('What fixtures to delete')
                .setRequired(true)
                .addChoices(
                    { name: 'All fixtures', value: 'all' },
                    { name: 'Pending fixtures', value: 'pending' },
                    { name: 'Played fixtures', value: 'played' },
                    { name: 'By matchday', value: 'matchday' },
                    { name: 'By phase', value: 'phase' }
                )
        )
        .addBooleanOption(opt =>
            opt.setName('confirm')
                .setDescription('Required safety confirmation')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Optional tournament key')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('value')
                .setDescription('Value for matchday/phase mode')
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

            const parsed = parsePrefixArgs(args);
            if (!parsed.ok) return message.reply(parsed.error);

            return await runDeleteFixtures({
                guild: message.guild,
                ...parsed,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[deletefixtures] prefix error:', error);
            return message.reply('❌ Failed to delete fixtures.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runDeleteFixtures({
                guild: interaction.guild,
                key: interaction.options.getString('key')?.toLowerCase() || null,
                mode: interaction.options.getString('mode'),
                value: interaction.options.getString('value'),
                confirm: interaction.options.getBoolean('confirm'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[deletefixtures] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to delete fixtures.');
            }

            return interaction.reply({ content: '❌ Failed to delete fixtures.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Build a filter query based on the selected mode and delete matching fixtures.
 */
async function runDeleteFixtures({ guild, key, mode, value, confirm, reply }) {
    if (!confirm) {
        return reply({ content: '⚠️ You must confirm this action.' });
    }

    /* ── Resolve tournament ── */
    const tournament = key
        ? await getTournamentByKey(guild.id, key)
        : await getDefaultTournament(guild.id);

    if (!tournament) {
        return reply({ content: '❌ Tournament not found.' });
    }

    /* ── Build the deletion query ── */
    const query = {
        guildId: guild.id,
        tournamentId: tournament._id
    };

    switch (mode) {
        case 'phase':
            if (!value) return reply({ content: '❌ Provide a phase value.' });
            query.phase = value.toLowerCase();
            break;

        case 'round':
            if (!value) return reply({ content: '❌ Provide a round label.' });
            query.roundLabel = value;
            break;

        case 'group':
            if (!value) return reply({ content: '❌ Provide a group key.' });
            query.groupKey = value.toUpperCase();
            break;

        case 'match':
            if (!value || Number.isNaN(Number(value))) {
                return reply({ content: '❌ Provide a valid match number.' });
            }
            query.matchNumber = parseInt(value, 10);
            break;

        case 'pending':
            query.status = 'Pending';
            break;

        case 'played':
            query.status = 'Played';
            break;

        case 'all':
            // No additional filters — delete everything for this tournament
            break;

        default:
            return reply({ content: '❌ Invalid mode.' });
    }

    /* ── Execute deletion ── */
    const result = await Fixture.deleteMany(query);

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🗑️ FIXTURES DELETED')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Mode: **${mode}**\n` +
            `Deleted: **${result.deletedCount}** fixture(s)` +
            (value ? `\nValue: **${value}**` : '')
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   PREFIX ARG PARSER
==================================================== */

/** Parse prefix arguments: [key] mode=<mode> value=<val> --confirm */
function parsePrefixArgs(args) {
    let key = null;
    let mode = null;
    let value = null;
    let confirm = false;

    for (const arg of args) {
        if (arg === '--confirm') confirm = true;
        else if (arg.startsWith('mode=')) mode = arg.slice(5).toLowerCase();
        else if (arg.startsWith('value=')) value = arg.slice(6);
        else if (!arg.includes('=') && !arg.startsWith('--') && !key) key = arg.toLowerCase();
    }

    if (!mode) {
        return {
            ok: false,
            error: '❌ Usage: `.deletefixtures [key] mode=<all|phase|round|group|match> value=<...> --confirm`'
        };
    }

    return { ok: true, key, mode, value, confirm };
}
