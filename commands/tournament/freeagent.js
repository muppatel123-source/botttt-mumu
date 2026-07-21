/**
 * freeagent.js
 *
 * Make a registered player a free agent without deleting their stats.
 * Removes them from their current team across all active tournaments.
 * Cannot be used on a team captain — change captain first.
 *
 * Usage:  .freeagent @user
 * Slash:  /freeagent user:<user>
 *
 * Aliases: fa, makefreeagent
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'freeagent',
    description: 'Make a player a free agent without deleting stats.',
    usage: '.freeagent @user',
    aliases: ['fa', 'makefreeagent'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('freeagent')
        .setDescription('Make a player a free agent without deleting stats')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to make free agent')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.freeagent @user`');
            }

            return await runFreeAgent({
                guild: message.guild,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[freeagent] prefix error:', error);
            return message.reply('❌ Failed to make player free agent.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 You are not authorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const target = interaction.options.getUser('user');

            return await runFreeAgent({
                guild: interaction.guild,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[freeagent] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to make player free agent.');
            }

            return interaction.reply({ content: '❌ Failed to make player free agent.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Convert a player to a free agent:
 * 1. Validate player exists and has a team
 * 2. Block if player is captain (must change captain first)
 * 3. Update TournamentPlayer entries in all active tournaments
 * 4. Update global Player record
 */
async function runFreeAgent({ guild, targetUser, reply }) {
    /* ── Find player with populated team ── */
    const player = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!player) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    const oldTeam = player.teamId;

    if (!oldTeam) {
        return reply({ content: `❌ ${targetUser} is already a **FREE AGENT**.` });
    }

    /* ── Block captain from becoming free agent directly ── */
    if (player.isCaptain || String(oldTeam.captainID) === String(targetUser.id)) {
        return reply({
            content:
                `❌ ${targetUser} is captain of **${oldTeam.name}**.\n` +
                `Change captain first with \`.cc @newCaptain\`, then try again.`
        });
    }

    /* ── Update tournament entries ── */
    const tournamentPlayersUpdated = await releaseFromActiveTournaments({
        guildId: guild.id,
        playerId: player._id
    });

    /* ── Update global player record ── */
    await Player.updateOne(
        { _id: player._id },
        {
            $set: {
                teamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    /* ── Remove captain Discord roles ── */
    const faMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (faMember) {
        const allSettings = await TournamentSettings.find({
            guildId: guild.id,
            captainRoleId: { $exists: true, $ne: '' }
        }).lean();
        const captainRoleIds = [...new Set(allSettings.map(t => t.captainRoleId).filter(Boolean))];
        for (const rid of captainRoleIds) {
            if (faMember.roles.cache.has(rid)) {
                await faMember.roles.remove(rid).catch(() => null);
            }
        }
    }

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('✅ Free Agent Updated')
        .setDescription(
            `${targetUser} is now a **FREE AGENT**.\n` +
            `Removed from **${oldTeam.name}**.`
        )
        .setFooter({
            text: `Tournament records updated: ${tournamentPlayersUpdated}`
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   TOURNAMENT SYNC
==================================================== */

/**
 * Remove a player from their team in all active tournament entries.
 * Sets them as free agent within each tournament.
 */
async function releaseFromActiveTournaments({ guildId, playerId }) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: { $ne: 'completed' }
    }).select('_id').lean();

    const activeTournamentIds = activeTournaments.map(t => t._id);

    if (!activeTournamentIds.length) return 0;

    const result = await TournamentPlayer.updateMany(
        {
            guildId,
            playerId,
            tournamentId: { $in: activeTournamentIds },
            isActive: true
        },
        {
            $set: {
                teamId: null,
                tournamentTeamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    return result.modifiedCount || 0;
}
