const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    Team,
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer
} = require('../../models/Tournament');

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

    async execute(message) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

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
            console.error('transfer prefix error:', error);
            return message.reply('❌ Failed to start transfer request.');
        }
    },

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
            console.error('transfer slash error:', error);

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

async function runTransferRequest({
    guild,
    actorId,
    targetUser,
    reply
}) {
    if (actorId === targetUser.id) {
        return reply({
            content: '❌ You cannot transfer yourself.'
        });
    }

    const newCaptainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!newCaptainPlayer?.teamId) {
        return reply({
            content: '❌ You are not linked to any team.'
        });
    }

    const newTeam = newCaptainPlayer.teamId;

    const isCaptain =
        String(newTeam.captainID) === String(actorId) ||
        newCaptainPlayer.isCaptain;

    const isViceCaptain =
        String(newTeam.viceCaptainID) === String(actorId) ||
        newCaptainPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({
            content: '❌ Only a team captain or vice captain can request transfers.'
        });
    }

    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    if (!targetPlayer.teamId) {
        return reply({
            content:
                `❌ ${targetUser} is currently a **FREE AGENT**.\n` +
                `Use a free-agent signing command instead of transfer.`
        });
    }

    const oldTeam = targetPlayer.teamId;

    if (String(oldTeam._id) === String(newTeam._id)) {
        return reply({
            content: `❌ ${targetUser} is already in **${newTeam.name}**.`
        });
    }

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

    const oldCaptainId = oldTeam.captainID;
    const oldViceCaptainId = oldTeam.viceCaptainID;

    if (!oldCaptainId && !oldViceCaptainId) {
        return reply({
            content:
                `❌ **${oldTeam.name}** does not have a captain or vice captain set.\n` +
                'Ask an organizer to fix the team captain first.'
        });
    }

    // Use captain for pings, but allow vice captain to approve too
    const oldTeamApprover = oldCaptainId || oldViceCaptainId;

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
        content: `<@${oldTeamApprover}> ${targetUser}`,
        embeds: [embed],
        components: [buttons]
    });

    if (!message?.createMessageComponentCollector) {
        return null;
    }

    const collector = message.createMessageComponentCollector({
        time: 75000
    });

    collector.on('collect', async interaction => {
        try {
            const allowedIds = new Set([
                String(targetUser.id),
                String(oldTeamApprover)
            ]);

            // Also allow old team's vice captain to approve
            if (oldViceCaptainId) {
                allowedIds.add(String(oldViceCaptainId));
            }

            if (!allowedIds.has(String(interaction.user.id))) {
                return interaction.reply({
                    content: '❌ This transfer approval is not for you.',
                    ephemeral: true
                });
            }

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

            if (interaction.customId === 'transfer_accept') {
                if (String(interaction.user.id) === String(targetUser.id)) {
                    state.playerAccepted = true;
                }

                if (String(interaction.user.id) === String(oldTeamApprover)) {
                    state.oldCaptainAccepted = true;
                }

                // Old team's vice captain can also approve
                if (oldViceCaptainId && String(interaction.user.id) === String(oldViceCaptainId)) {
                    state.oldCaptainAccepted = true;
                }

                if (state.playerAccepted && state.oldCaptainAccepted) {
                    const result = await completeTransfer({
                        guild,
                        targetPlayer,
                        targetUser,
                        oldTeam,
                        newTeam
                    });

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
        } catch (error) {
            console.error('transfer collector error:', error);

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

async function completeTransfer({
    guild,
    targetPlayer,
    oldTeam,
    newTeam
}) {
    await Player.updateOne(
        {
            _id: targetPlayer._id
        },
        {
            $set: {
                teamId: newTeam._id,
                teamNameSnapshot: newTeam.name,
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    const activeTournaments = await TournamentSettings.find({
        guildId: guild.id,
        currentPhase: {
            $ne: 'completed'
        }
    });

    let updatedTournamentPlayers = 0;

    for (const tournament of activeTournaments) {
        const newTournamentTeam = await TournamentTeam.findOne({
            guildId: guild.id,
            tournamentId: tournament._id,
            teamId: newTeam._id,
            isActive: true
        });

        if (!newTournamentTeam) {
            continue;
        }

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

    return {
        updatedTournamentPlayers
    };
}

function buildTransferEmbed({
    status,
    targetUser,
    oldTeam,
    newTeam,
    oldTeamApprover,
    oldViceCaptainId,
    state,
    rejectedBy,
    updatedTournamentPlayers
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
            `Required approvals within **75 seconds**:\n` +
            `Player: ${state.playerAccepted ? '✅ Accepted' : '⏳ Waiting'}\n` +
            `Old Team <@${oldTeamApprover}>${oldViceCaptainId ? ` / <@${oldViceCaptainId}>` : ''}: ${state.oldCaptainAccepted ? '✅ Accepted' : '⏳ Waiting'}`;
    }

    if (status === 'completed') {
        description =
            `${targetUser} has joined **${newTeam.name}**.\n\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**\n` +
            `Active tournament records updated: **${updatedTournamentPlayers || 0}**\n\n` +
            `Old stats were not deleted.`;
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
            `Transfer request expired.\n\n` +
            `Player: ${targetUser}\n` +
            `From: **${oldTeam.name}**\n` +
            `To: **${newTeam.name}**`;
    }

    return new EmbedBuilder()
        .setColor(colors[status] || 0xFEE75C)
        .setTitle(titles[status] || '🔁 TRANSFER')
        .setDescription(description)
        .setTimestamp();
}

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

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}