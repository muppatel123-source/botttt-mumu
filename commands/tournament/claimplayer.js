/**
 * claimplayer.js
 *
 * Sign a free agent (unregistered or teamless player) to your team.
 * Captain or Vice Captain only.
 * Updates global Player record + all active TournamentPlayer entries.
 *
 * Usage: .claimplayer @user
 * Slash: /claimplayer user:<user>
 *
 * Aliases: sign, signplayer
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    ServerConfig
} = require('../../models/Tournament');

const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'claimplayer',
    description: 'Sign a free agent to your team as captain.',
    usage: '.claimplayer @user',
    aliases: ['sign', 'signplayer'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('claimplayer')
        .setDescription('Sign a free agent to your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Free agent to sign')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            const target = message.mentions.users.first() || await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.claimplayer @user`');
            }

            return await runClaimPlayer({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[claimplayer] prefix error:', error);
            return message.reply('❌ Failed to claim player.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('user');

            return await runClaimPlayer({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[claimplayer] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to claim player.');
            }

            return interaction.reply({
                content: '❌ Failed to claim player.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Claim a free agent for the actor's team.
 * Validates: actor is captain/VC, target is registered and teamless.
 */
async function runClaimPlayer({ guild, actorId, targetUser, reply }) {
    // ── Transfer lock check ──
    const config = await ServerConfig.findOne({ guildId: guild.id }).lean();
    if (config?.transfersLocked) {
        return reply({ content: '🔒 Transfers are **locked**. The transfer window is currently closed.' });
    }

    // ── Verify actor is captain/VC ──
    const captainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!captainPlayer?.teamId) {
        return reply({ content: '❌ You are not linked to any team.' });
    }

    const team = captainPlayer.teamId;

    const isCaptain =
        String(team.captainID) === String(actorId) ||
        captainPlayer.isCaptain;

    const isViceCaptain =
        String(team.viceCaptainID) === String(actorId) ||
        captainPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({ content: '❌ Only the team captain or vice captain can claim free agents.' });
    }

    // ── Find target player ──
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    if (targetPlayer.teamId) {
        return reply({
            content:
                `❌ ${targetUser} is not a free agent.\n` +
                'Use `.transfer @user` if the player belongs to another team.'
        });
    }

    // ── Update global player record ──
    await Player.updateOne(
        { _id: targetPlayer._id },
        {
            $set: {
                teamId: team._id,
                teamNameSnapshot: team.name,
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    // ── Update all active tournament entries ──
    const updatedTournamentPlayers = await assignPlayerToActiveTournaments({
        guildId: guild.id,
        playerId: targetPlayer._id,
        team
    });

    // ── Response ──
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ PLAYER SIGNED')
        .setDescription(
            `${targetUser} has joined **${team.name}**.\n\n` +
            `Tournament records updated: **${updatedTournamentPlayers}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   TOURNAMENT SYNC
==================================================== */

/**
 * Assign a player to all active tournaments where their team is registered.
 * Updates TournamentPlayer entries with the new team.
 */
async function assignPlayerToActiveTournaments({ guildId, playerId, team }) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: { $ne: 'completed' }
    }).lean();

    let updated = 0;

    for (const tournament of activeTournaments) {
        const tournamentTeam = await TournamentTeam.findOne({
            guildId,
            tournamentId: tournament._id,
            teamId: team._id,
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
                    teamId: team._id,
                    tournamentTeamId: tournamentTeam._id,
                    teamNameSnapshot: team.name,
                    isCaptain: false,
                    isViceCaptain: false
                }
            }
        );

        updated += result.modifiedCount || 0;
    }

    return updated;
}
