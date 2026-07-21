/**
 * transfer.js
 *
 * Two-party player transfer system.
 * Captain/VC of the new team initiates. Both the player and the old team's
 * captain/VC must accept within the timeout window.
 *
 * Updates global Player record + all active TournamentPlayer entries.
 *
 * Usage:  .transfer @user
 * Slash:  /transfer user:<user>
 * Aliases: tr
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    Player,
    Team,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    ServerConfig
} = require('../../models/Tournament');

const { getUserFromArgs } = require('../../utils/stringHelpers');

/** How long both parties have to accept (5 minutes) */
const TRANSFER_TIMEOUT = 5 * 60 * 1000;

module.exports = {
    name: 'transfer',
    description: 'Request a player transfer with approval buttons.',
    usage: '.transfer @user',
    aliases: ['tr'],
    hidden: false,
    cooldown: 10,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('transfer')
        .setDescription('Request a player transfer')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to transfer')
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
                return message.reply('❌ Usage: `.transfer @user`');
            }

            return await runTransferRequest({
                guild: message.guild,
                channel: message.channel,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[transfer] prefix error:', error);
            return message.reply('❌ Failed to start transfer request.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');

            return await runTransferRequest({
                guild: interaction.guild,
                channel: interaction.channel,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[transfer] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to start transfer request.');
            }

            return interaction.reply({
                content: '❌ Failed to start transfer request.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Validate the transfer request, build the approval UI, and start the collector.
 */
async function runTransferRequest({ guild, channel, actorId, targetUser, reply }) {
    // ── Transfer lock check ──
    const config = await ServerConfig.findOne({ guildId: guild.id }).lean();
    if (config?.transfersLocked) {
        return reply({ content: '🔒 Transfers are **locked**. The transfer window is currently closed.' });
    }

    // ── Self-transfer check ──
    if (actorId === targetUser.id) {
        return reply({ content: '❌ You cannot transfer yourself.' });
    }

    // ── Verify actor is captain/VC of a team ──
    const newCaptainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!newCaptainPlayer?.teamId) {
        return reply({ content: '❌ You are not linked to any team.' });
    }

    const newTeam = newCaptainPlayer.teamId;

    const isCaptain =
        String(newTeam.captainID) === String(actorId) ||
        newCaptainPlayer.isCaptain;

    const isViceCaptain =
        String(newTeam.viceCaptainID) === String(actorId) ||
        newCaptainPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({ content: '❌ Only a team captain or vice captain can request transfers.' });
    }

    // ── Find target player ──
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!targetPlayer) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    if (!targetPlayer.teamId) {
        return reply({
            content:
                `❌ ${targetUser} is currently a **FREE AGENT**.\n` +
                'Use `.claimplayer @user` to sign them instead.'
        });
    }

    const oldTeam = targetPlayer.teamId;

    // ── Same-team check ──
    if (String(oldTeam._id) === String(newTeam._id)) {
        return reply({ content: `❌ ${targetUser} is already in **${newTeam.name}**.` });
    }

    // ── Cannot transfer a captain ──
    const targetIsCaptain =
        targetPlayer.isCaptain ||
        String(oldTeam.captainID) === String(targetUser.id);

    if (targetIsCaptain) {
        return reply({
            content:
                `❌ ${targetUser} is currently the captain of **${oldTeam.name}**.\n\n` +
                `${targetUser}, transfer captaincy first using:\n` +
                '`.cc @newCaptain`\n\n' +
                'After captaincy is changed, try the transfer again.'
        });
    }

    // ── Determine old team approvers ──
    const oldCaptainId = oldTeam.captainID;
    const oldViceCaptainId = oldTeam.viceCaptainID;

    if (!oldCaptainId && !oldViceCaptainId) {
        return reply({
            content:
                `❌ **${oldTeam.name}** does not have a captain or vice captain set.\n` +
                'Ask an organizer to fix the team captain first.'
        });
    }

    // Primary approver is captain; fallback to VC
    const oldTeamApprover = oldCaptainId || oldViceCaptainId;

    // ── Build approval state ──
    const state = {
        playerAccepted: false,
        oldCaptainAccepted: false,
        rejected: false
    };

    const embed = buildTransferEmbed({
        status: 'pending',
        targetUser,
        oldTeam,
        newTeam,
        oldTeamApprover,
        oldViceCaptainId,
        state
    });

    const buttons = buildButtons(false);

    const message = await reply({
        content: `<@${oldTeamApprover}> <@${targetUser.id}>`,
        embeds: [embed],
        components: [buttons]
    });

    if (!message?.createMessageComponentCollector) return null;

    // ── Approval collector ──
    const collector = message.createMessageComponentCollector({
        time: TRANSFER_TIMEOUT
    });

    collector.on('collect', async (interaction) => {
        try {
            await handleTransferInteraction({
                interaction,
                targetUser,
                oldTeamApprover,
                oldViceCaptainId,
                oldCaptainId,
                state,
                guild,
                targetPlayer,
                oldTeam,
                newTeam,
                collector,
                message
            });
        } catch (error) {
            console.error('[transfer] collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Transfer interaction failed.',
                    ephemeral: true
                }).catch(() => null);
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'completed' || reason === 'rejected') return;

        const expiredEmbed = buildTransferEmbed({
            status: 'expired',
            targetUser,
            oldTeam,
            newTeam,
            oldTeamApprover,
            oldViceCaptainId,
            state
        });

        await message.edit({
            content: null,
            embeds: [expiredEmbed],
            components: [buildButtons(true)]
        }).catch(() => null);
    });
}

/* ====================================================
   INTERACTION HANDLER
==================================================== */

/**
 * Handle a button press during the transfer approval flow.
 */
async function handleTransferInteraction({
    interaction, targetUser, oldTeamApprover, oldViceCaptainId, oldCaptainId,
    state, guild, targetPlayer, oldTeam, newTeam, collector, message
}) {
    const userId = String(interaction.user.id);

    // ── Permission check ──
    const allowedIds = new Set([
        String(targetUser.id),
        String(oldTeamApprover)
    ]);

    // Old team's VC can also interact
    if (oldViceCaptainId) {
        allowedIds.add(String(oldViceCaptainId));
    }

    if (!allowedIds.has(userId)) {
        return interaction.reply({
            content: '❌ This transfer approval is not for you.',
            ephemeral: true
        });
    }

    // ── Reject ──
    if (interaction.customId === 'transfer_reject') {
        state.rejected = true;

        const rejectedEmbed = buildTransferEmbed({
            status: 'rejected',
            targetUser,
            oldTeam,
            newTeam,
            oldTeamApprover,
            oldViceCaptainId,
            state,
            rejectedBy: interaction.user.id
        });

        collector.stop('rejected');

        return interaction.update({
            content: null,
            embeds: [rejectedEmbed],
            components: [buildButtons(true)]
        });
    }

    // ── Accept ──
    if (interaction.customId === 'transfer_accept') {
        // Player accepts
        if (userId === String(targetUser.id)) {
            state.playerAccepted = true;
        }

        // Old team captain explicitly accepts (not VC impersonating captain)
        if (oldCaptainId && userId === String(oldCaptainId)) {
            state.oldCaptainAccepted = true;
        }

        // Old team VC can approve if no captain exists, or VC is the designated approver
        if (oldViceCaptainId && userId === String(oldViceCaptainId) && !oldCaptainId) {
            state.oldCaptainAccepted = true;
        }

        // ── Both approved → complete transfer ──
        if (state.playerAccepted && state.oldCaptainAccepted) {
            const result = await completeTransfer({ guild, targetPlayer, oldTeam, newTeam });

            const completedEmbed = buildTransferEmbed({
                status: 'completed',
                targetUser,
                oldTeam,
                newTeam,
                oldTeamApprover,
                oldViceCaptainId,
                state,
                updatedTournamentPlayers: result.updatedTournamentPlayers
            });

            collector.stop('completed');

            return interaction.update({
                content: null,
                embeds: [completedEmbed],
                components: [buildButtons(true)]
            });
        }

        // ── Partial approval → update embed ──
        const updatedEmbed = buildTransferEmbed({
            status: 'pending',
            targetUser,
            oldTeam,
            newTeam,
            oldTeamApprover,
            oldViceCaptainId,
            state
        });

        return interaction.update({
            embeds: [updatedEmbed],
            components: [buildButtons(false)]
        });
    }
}

/* ====================================================
   TRANSFER EXECUTION
==================================================== */

/**
 * Execute the transfer: update global Player and all active TournamentPlayer records.
 */
async function completeTransfer({ guild, targetPlayer, oldTeam, newTeam }) {
    // ── Update global player record ──
    await Player.updateOne(
        { _id: targetPlayer._id },
        {
            $set: {
                teamId: newTeam._id,
                teamNameSnapshot: newTeam.name,
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    // ── Update all active tournament entries ──
    const activeTournaments = await TournamentSettings.find({
        guildId: guild.id,
        currentPhase: { $ne: 'completed' }
    });

    let updatedTournamentPlayers = 0;

    for (const tournament of activeTournaments) {
        const newTournamentTeam = await TournamentTeam.findOne({
            guildId: guild.id,
            tournamentId: tournament._id,
            teamId: newTeam._id,
            isActive: true
        });

        if (!newTournamentTeam) continue;

        const result = await TournamentPlayer.updateMany(
            {
                guildId: guild.id,
                tournamentId: tournament._id,
                playerId: targetPlayer._id,
                isActive: true
            },
            {
                $set: {
                    teamId: newTeam._id,
                    tournamentTeamId: newTournamentTeam._id,
                    teamNameSnapshot: newTeam.name,
                    isCaptain: false,
                    isViceCaptain: false
                }
            }
        );

        updatedTournamentPlayers += result.modifiedCount || 0;
    }

    // ── Assign player role for new team's tournament ──
    const newestSettings = await TournamentSettings.findOne({
        guildId: guild.id,
        $or: [
            { registrationOpen: true },
            { currentPhase: { $in: ['registration', 'league', 'groups', 'knockout'] } }
        ]
    }).sort({ createdAt: -1 });

    const targetMember = await guild.members.fetch(targetPlayer.discordID).catch(() => null);
    if (targetMember && newestSettings?.tournamentPlayerRoleId) {
        try {
            const role = guild.roles.cache.get(newestSettings.tournamentPlayerRoleId);
            if (role && !targetMember.roles.cache.has(role.id)) {
                await targetMember.roles.add(role).catch(() => null);
            }
        } catch {}
    }

    return { updatedTournamentPlayers };
}

/* ====================================================
   EMBED BUILDER
==================================================== */

/**
 * Build a transfer embed for any status (pending, completed, rejected, expired).
 */
function buildTransferEmbed({
    status, targetUser, oldTeam, newTeam,
    oldTeamApprover, oldViceCaptainId, state,
    rejectedBy, updatedTournamentPlayers
}) {
    const colors = {
        pending: 0xFEE75C,
        completed: 0x57F287,
        rejected: 0xED4245,
        expired: 0x95A5A6
    };

    const titles = {
        pending: '🔁 TRANSFER REQUEST',
        completed: '✅ TRANSFER COMPLETED',
        rejected: '❌ TRANSFER REJECTED',
        expired: '⌛ TRANSFER EXPIRED'
    };

    let description = '';

    if (status === 'pending') {
        description =
            `<@${newTeam.captainID || newTeam.viceCaptainID}> wants to sign ${targetUser}.\n\n` +
            `Player: ${targetUser}\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**\n\n` +
            `Required approvals:\n` +
            `Player: ${state.playerAccepted ? '✅ Accepted' : '⏳ Waiting'}\n` +
            `Old Team <@${oldTeamApprover}>${oldViceCaptainId ? ` / <@${oldViceCaptainId}>` : ''}: ${state.oldCaptainAccepted ? '✅ Accepted' : '⏳ Waiting'}`;
    }

    if (status === 'completed') {
        description =
            `${targetUser} has joined **${newTeam.name}**.\n\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**\n` +
            `Active tournament records updated: **${updatedTournamentPlayers || 0}**`;
    }

    if (status === 'rejected') {
        description =
            `Transfer collapsed.\n\n` +
            `Rejected by: <@${rejectedBy}>\n` +
            `Player: ${targetUser}\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**`;
    }

    if (status === 'expired') {
        description =
            `Transfer request expired — not all approvals were received in time.\n\n` +
            `Player: ${targetUser}\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**\n\n` +
            'Run `.transfer @user` to try again.';
    }

    return new EmbedBuilder()
        .setColor(colors[status] || 0xFEE75C)
        .setTitle(titles[status] || '🔁 TRANSFER')
        .setDescription(description)
        .setTimestamp();
}

/* ====================================================
   BUTTON BUILDER
==================================================== */

/**
 * Build the accept/reject button row.
 * @param {boolean} disabled - Disable both buttons
 */
function buildButtons(disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('transfer_accept')
            .setLabel('Accept')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),

        new ButtonBuilder()
            .setCustomId('transfer_reject')
            .setLabel('Reject')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}
