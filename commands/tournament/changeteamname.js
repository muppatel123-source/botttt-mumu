/**
 * changeteamname.js
 *
 * Change a team name safely across all collections.
 * Captains/VCs can rename their own team; organizers can rename any team.
 *
 * Usage:  .ctn <new name>
 *         .ctn <old name> => <new name>   (organizer only)
 * Slash:  /changeteamname new_name:<name> [old_name:<name>]
 *
 * Aliases: ctn, renameteam
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    Fixture
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { escapeRegex } = require('../../utils/stringHelpers');

module.exports = {
    name: 'changeteamname',
    description: 'Change a team name safely.',
    usage: '.ctn <new name> OR .ctn <old name> => <new name>',
    aliases: ['ctn', 'renameteam'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('changeteamname')
        .setDescription('Change a team name safely')
        .addStringOption(opt =>
            opt.setName('new_name')
                .setDescription('New team name')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('old_name')
                .setDescription('Old team name (organizer only). Captains can omit this.')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!args.length) {
                return message.reply(
                    '❌ Usage:\n' +
                    'Captain: `.ctn <new name>`\n' +
                    'Organizer: `.ctn <old name> => <new name>`'
                );
            }

            const parsed = parsePrefixArgs(args);

            return await runChangeTeamName({
                guild: message.guild,
                actorId: message.author.id,
                oldName: parsed.oldName,
                newName: parsed.newName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[changeteamname] prefix error:', error);
            return message.reply('❌ Failed to change team name.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            return await runChangeTeamName({
                guild: interaction.guild,
                actorId: interaction.user.id,
                oldName: interaction.options.getString('old_name'),
                newName: interaction.options.getString('new_name'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[changeteamname] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change team name.');
            }

            return interaction.reply({
                content: '❌ Failed to change team name.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Rename a team across all collections.
 * - If oldName is provided: organizer-only path.
 * - If oldName is omitted: auto-detect from actor's team (captain/VC only).
 */
async function runChangeTeamName({ guild, actorId, oldName, newName, reply }) {
    const cleanNewName = normalizeName(newName);

    /* ── Validate new name ── */
    if (!cleanNewName || cleanNewName.length < 2 || cleanNewName.length > 50) {
        return reply({ content: '❌ New team name must be between 2 and 50 characters.' });
    }

    /* ── Check for duplicate name ── */
    const duplicate = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(cleanNewName)}$`, 'i') }
    });

    if (duplicate) {
        return reply({ content: `❌ A team named **${cleanNewName}** already exists.` });
    }

    /* ── Resolve which team to rename ── */
    let team = null;
    const organizer = await isOrganizer(guild.id, actorId);

    if (oldName) {
        // Organizer path — rename any team
        if (!organizer) {
            return reply({ content: '❌ Only organizers can rename another team by old name.' });
        }

        team = await Team.findOne({
            guildId: guild.id,
            name: { $regex: new RegExp(`^${escapeRegex(normalizeName(oldName))}$`, 'i') }
        });
    } else {
        // Captain/VC path — rename own team
        const captainPlayer = await Player.findOne({
            guildId: guild.id,
            discordID: actorId
        }).populate('teamId');

        if (!captainPlayer?.teamId) {
            return reply({ content: '❌ You are not linked to any team.' });
        }

        team = captainPlayer.teamId;

        const isCaptain =
            String(team.captainID) === String(actorId) ||
            captainPlayer.isCaptain;

        const isViceCaptain =
            String(team.viceCaptainID) === String(actorId) ||
            captainPlayer.isViceCaptain;

        if (!isCaptain && !isViceCaptain) {
            return reply({ content: '❌ Only the team captain or vice captain can rename their team.' });
        }
    }

    if (!team) {
        return reply({ content: '❌ Team not found.' });
    }

    const oldTeamName = team.name;

    /* ── Update core Team name ── */
    await Team.updateOne(
        { _id: team._id },
        { $set: { name: cleanNewName } }
    );

    /* ── Update global Player snapshots ── */
    await Player.updateMany(
        { guildId: guild.id, teamId: team._id },
        { $set: { teamNameSnapshot: cleanNewName } }
    );

    /* ── Update active tournament data ── */
    const activeTournaments = await TournamentSettings.find({
        guildId: guild.id,
        currentPhase: { $ne: 'completed' }
    }).select('_id').lean();

    const activeTournamentIds = activeTournaments.map(t => t._id);
    let tournamentTeamsUpdated = 0;
    let tournamentPlayersUpdated = 0;
    let fixturesUpdated = 0;

    if (activeTournamentIds.length) {
        const ttResult = await TournamentTeam.updateMany(
            { guildId: guild.id, tournamentId: { $in: activeTournamentIds }, teamId: team._id },
            { $set: { teamNameSnapshot: cleanNewName } }
        );
        tournamentTeamsUpdated = ttResult.modifiedCount || 0;

        const tpResult = await TournamentPlayer.updateMany(
            { guildId: guild.id, tournamentId: { $in: activeTournamentIds }, teamId: team._id },
            { $set: { teamNameSnapshot: cleanNewName } }
        );
        tournamentPlayersUpdated = tpResult.modifiedCount || 0;

        // Update fixture home/away name snapshots
        const homeResult = await Fixture.updateMany(
            { guildId: guild.id, tournamentId: { $in: activeTournamentIds }, homeTeamId: team._id },
            { $set: { homeTeam: cleanNewName } }
        );

        const awayResult = await Fixture.updateMany(
            { guildId: guild.id, tournamentId: { $in: activeTournamentIds }, awayTeamId: team._id },
            { $set: { awayTeam: cleanNewName } }
        );

        fixturesUpdated =
            (homeResult.modifiedCount || 0) +
            (awayResult.modifiedCount || 0);
    }

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Team Name Changed')
        .setDescription(`**${oldTeamName}** → **${cleanNewName}**`)
        .setFooter({
            text:
                `Tournament teams: ${tournamentTeamsUpdated} • ` +
                `Tournament players: ${tournamentPlayersUpdated} • ` +
                `Fixtures: ${fixturesUpdated}`
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   HELPERS
==================================================== */

/** Parse prefix args — supports `<old name> => <new name>` or just `<new name>`. */
function parsePrefixArgs(args) {
    const text = args.join(' ').trim();

    if (text.includes('=>')) {
        const [oldName, newName] = text.split('=>').map(v => v.trim());
        return { oldName, newName };
    }

    return { oldName: null, newName: text };
}

/** Collapse whitespace and trim. */
function normalizeName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
}
