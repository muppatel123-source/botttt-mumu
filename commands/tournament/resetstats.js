/**
 * resetstats.js
 *
 * Reset tournament player stats and/or team standings.
 * Three modes: players only, teams only, or all.
 * Requires explicit confirmation to prevent accidents.
 *
 * Usage:  .resetstats <tournamentKey> confirm [--players|--teams|--all]
 * Slash:  /resetstats key:<key> confirm:true [mode]
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    TournamentSettings,
    TournamentPlayer,
    TournamentTeam
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'resetstats',
    description: 'Reset tournament player stats and/or team standings.',
    usage: '.resetstats <tournamentKey> confirm [--players|--teams|--all]',
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('resetstats')
        .setDescription('Reset stats for a specific tournament')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addBooleanOption(opt =>
            opt.setName('confirm')
                .setDescription('Required safety confirmation')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('mode')
                .setDescription('What to reset')
                .setRequired(false)
                .addChoices(
                    { name: 'Players Only', value: 'players' },
                    { name: 'Teams Only', value: 'teams' },
                    { name: 'All Tournament Stats', value: 'all' }
                )
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 **Access Denied.** This is a high-level admin command.');
            }

            const parsed = parsePrefixArgs(args);
            if (!parsed.ok) return message.reply(parsed.error);

            const waitMsg = await message.reply('⏳ **Resetting tournament stats...** Please wait.');

            const result = await runReset({
                guildId: message.guild.id,
                tournamentKey: parsed.tournamentKey,
                mode: parsed.mode
            });

            return waitMsg.edit({
                content: null,
                embeds: [buildSuccessEmbed({ ...result, mode: parsed.mode, actorTag: message.author.tag })]
            });
        } catch (error) {
            console.error('[resetstats] prefix error:', error);
            return message.reply('❌ **Database Error:** Failed to reset statistics.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 **Access Denied.** This is a high-level admin command.',
                    ephemeral: true
                });
            }

            const confirm = interaction.options.getBoolean('confirm');

            if (!confirm) {
                return interaction.reply({
                    content: '⚠️ You must set `confirm` to `true` to run this reset.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const result = await runReset({
                guildId: interaction.guild.id,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                mode: interaction.options.getString('mode') || 'all'
            });

            return interaction.editReply({
                embeds: [buildSuccessEmbed({
                    ...result,
                    mode: interaction.options.getString('mode') || 'all',
                    actorTag: interaction.user.tag
                })]
            });
        } catch (error) {
            console.error('[resetstats] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ **Database Error:** Failed to reset statistics.');
            }

            return interaction.reply({ content: '❌ **Database Error:** Failed to reset statistics.', ephemeral: true });
        }
    }
};

/* ====================================================
   PREFIX ARG PARSER
==================================================== */

function parsePrefixArgs(args) {
    if (!args.length) {
        return {
            ok: false,
            error:
                '❌ Usage: `.resetstats <tournamentKey> confirm [--players|--teams|--all]`\n' +
                'Example: `.resetstats league-s1 confirm --all`'
        };
    }

    const tournamentKey = args[0]?.toLowerCase();
    const confirm = args[1]?.toLowerCase() === 'confirm';

    if (!tournamentKey || !confirm) {
        return {
            ok: false,
            error:
                '⚠️ **CRITICAL ACTION**\n' +
                'This resets stats for one tournament only.\n\n' +
                'Use:\n' +
                '`.resetstats <tournamentKey> confirm --all`\n' +
                '`.resetstats <tournamentKey> confirm --players`\n' +
                '`.resetstats <tournamentKey> confirm --teams`'
        };
    }

    let mode = 'all';

    if (args.includes('--players')) mode = 'players';
    if (args.includes('--teams')) mode = 'teams';
    if (args.includes('--all')) mode = 'all';

    return { ok: true, tournamentKey, mode };
}

/* ====================================================
   CORE LOGIC
==================================================== */

/** Reset player stats, team standings, or both for a tournament. */
async function runReset({ guildId, tournamentKey, mode }) {
    const tournament = await TournamentSettings.findOne({ guildId, tournamentKey });

    if (!tournament) {
        throw new Error(`Tournament not found: ${tournamentKey}`);
    }

    let playerResult = { matchedCount: 0, modifiedCount: 0 };
    let teamResult = { matchedCount: 0, modifiedCount: 0 };

    /* ── Reset player stats ── */
    if (mode === 'players' || mode === 'all') {
        playerResult = await TournamentPlayer.updateMany(
            { guildId, tournamentId: tournament._id },
            {
                $set: {
                    'stats.played': 0,
                    'stats.goals': 0,
                    'stats.assists': 0,
                    'stats.saves': 0,
                    'stats.tackles': 0,
                    'stats.interceptions': 0,
                    'stats.yc': 0,
                    'stats.rc': 0,
                    'stats.mvps': 0
                }
            }
        );
    }

    /* ── Reset team standings ── */
    if (mode === 'teams' || mode === 'all') {
        teamResult = await TournamentTeam.updateMany(
            { guildId, tournamentId: tournament._id },
            {
                $set: {
                    'stats.played': 0,
                    'stats.wins': 0,
                    'stats.draws': 0,
                    'stats.losses': 0,
                    'stats.gf': 0,
                    'stats.ga': 0,
                    'stats.points': 0
                }
            }
        );
    }

    return {
        tournament,
        matchedPlayers: playerResult.matchedCount ?? 0,
        modifiedPlayers: playerResult.modifiedCount ?? 0,
        matchedTeams: teamResult.matchedCount ?? 0,
        modifiedTeams: teamResult.modifiedCount ?? 0
    };
}

/* ====================================================
   EMBED BUILDER
==================================================== */

function buildSuccessEmbed({ tournament, matchedPlayers, modifiedPlayers, matchedTeams, modifiedTeams, mode, actorTag }) {
    return new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🧹 TOURNAMENT STATS RESET')
        .setDescription(
            `${tournament.emoji || '🏆'} Tournament: **${tournament.name}**\n` +
            `Key: \`${tournament.tournamentKey}\`\n\n` +
            `Mode: **${mode}**`
        )
        .addFields(
            {
                name: 'Player Stats Reset',
                value:
                    mode === 'players' || mode === 'all'
                        ? `Matched: **${matchedPlayers}**\nModified: **${modifiedPlayers}**`
                        : 'Skipped',
                inline: true
            },
            {
                name: 'Team Standings Reset',
                value:
                    mode === 'teams' || mode === 'all'
                        ? `Matched: **${matchedTeams}**\nModified: **${modifiedTeams}**`
                        : 'Skipped',
                inline: true
            },
            {
                name: 'Unaffected',
                value:
                    'Global teams, global players, all-time stats, trophies, awards, fixtures, logos, colors, stadiums, and tournament settings were not deleted.',
                inline: false
            }
        )
        .setFooter({ text: `Action performed by ${actorTag}` })
        .setTimestamp();
}
