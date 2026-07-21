/**
 * moveplayer.js
 *
 * Organizer command to directly move a player to a different team.
 * Cannot move captains — change captain first.
 * Updates global Player + all active TournamentPlayer entries.
 *
 * Usage:  .moveplayer @user <team name>
 * Slash:  /moveplayer user:<user> team:<team>
 *
 * Aliases: mp, forcemoveplayer
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
    TournamentPlayer
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { escapeRegex, getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'moveplayer',
    description: 'Organizer command to directly move a player to a team.',
    usage: '.moveplayer @user <team name>',
    aliases: ['mp', 'forcemoveplayer'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('moveplayer')
        .setDescription('Directly move a player to a team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to move')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Target team name')
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

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.moveplayer @user <team name>`');
            }

            const teamName = args
                .join(' ')
                .replace(/<@!?\d{17,20}>/g, '')
                .replace(/\d{17,20}/g, '')
                .trim();

            if (!teamName) {
                return message.reply('❌ Usage: `.moveplayer @user <team name>`');
            }

            return await runMovePlayer({
                guild: message.guild,
                targetUser: target,
                teamName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[moveplayer] prefix error:', error);
            return message.reply('❌ Failed to move player.');
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

            return await runMovePlayer({
                guild: interaction.guild,
                targetUser: interaction.options.getUser('user'),
                teamName: interaction.options.getString('team'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[moveplayer] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to move player.');
            }

            return interaction.reply({ content: '❌ Failed to move player.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Move a player to a new team:
 * 1. Validate player exists and is not captain
 * 2. Resolve target team
 * 3. Update global Player record
 * 4. Update all active TournamentPlayer entries
 */
async function runMovePlayer({ guild, targetUser, teamName, reply }) {
    /* ── Find player ── */
    const player = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!player) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    const oldTeam = player.teamId || null;

    /* ── Block captain from being moved directly ── */
    if (oldTeam && (player.isCaptain || String(oldTeam.captainID) === String(targetUser.id))) {
        return reply({
            content:
                `❌ ${targetUser} is currently captain of **${oldTeam.name}**.\n` +
                `Use \`.fixcaptain ${oldTeam.name} @newCaptain\` or \`.cc @newCaptain\` first.`
        });
    }

    /* ── Resolve target team ── */
    const newTeam = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (!newTeam) {
        return reply({ content: `❌ Target team not found: \`${teamName}\`` });
    }

    if (oldTeam && String(oldTeam._id) === String(newTeam._id)) {
        return reply({ content: `❌ ${targetUser} is already in **${newTeam.name}**.` });
    }

    /* ── Update global player record ── */
    await Player.updateOne(
        { _id: player._id },
        {
            $set: {
                teamId: newTeam._id,
                teamNameSnapshot: newTeam.name,
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    /* ── Update active tournament entries ── */
    const updatedTournamentPlayers = await updateActiveTournamentPlayerTeams({
        guildId: guild.id,
        playerId: player._id,
        newTeam
    });

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Player Moved')
        .setDescription(
            `${targetUser} moved to **${newTeam.name}**.\n` +
            `Old Team: **${oldTeam?.name || 'FREE AGENT'}**`
        )
        .setFooter({
            text: `Active tournament records updated: ${updatedTournamentPlayers}`
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   TOURNAMENT SYNC
==================================================== */

/** Update a player's team across all active tournaments where the new team is registered. */
async function updateActiveTournamentPlayerTeams({ guildId, playerId, newTeam }) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: { $ne: 'completed' }
    }).lean();

    let updated = 0;

    for (const tournament of activeTournaments) {
        const tournamentTeam = await TournamentTeam.findOne({
            guildId,
            tournamentId: tournament._id,
            teamId: newTeam._id,
            isActive: true
        });

        if (!tournamentTeam) continue;

        const result = await TournamentPlayer.updateMany(
            {
                guildId,
                tournamentId: tournament._id,
                playerId,
                isActive: true
            },
            {
                $set: {
                    teamId: newTeam._id,
                    tournamentTeamId: tournamentTeam._id,
                    teamNameSnapshot: newTeam.name,
                    isCaptain: false,
                    isViceCaptain: false
                }
            }
        );

        updated += result.modifiedCount || 0;
    }

    return updated;
}
