/**
 * setvicecaptain.js
 *
 * Set the vice captain of a team.
 *
 * Usage:
 *   .setvicecaptain @user    (or .svc @user)
 *   .svc @user remove        (to remove vice captain)
 *
 * WHO CAN RUN THIS:
 *   - Team captain
 *   - Organizers
 *
 * WHAT IT DOES:
 *   - Target must be a registered player on the SAME team
 *   - Sets Team.viceCaptainID
 *   - Sets Player.isViceCaptain = true for target
 *   - Sets Player.isViceCaptain = false for all other team members
 *   - Updates TournamentPlayer.isViceCaptain across all active tournaments
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

const {
    isOrganizer
} = require('../../utils/isOrganizer');
const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'setvicecaptain',
    description: 'Set the vice captain of your team.',
    usage: '.svc @user [remove]',
    aliases: ['svc', 'setvc', 'vicecaptain'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setvicecaptain')
        .setDescription('Set the vice captain of your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to set as vice captain')
                .setRequired(true)
        )
        .addBooleanOption(opt =>
            opt.setName('remove')
                .setDescription('Remove vice captain instead')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❓ Usage: `.svc @user` or `.svc @user remove`');
            }

            const remove = args.includes('remove') || args.includes('clear');

            return await runSetViceCaptain({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                remove,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setvicecaptain] prefix error:', error);
            return message.reply('❌ Failed to set vice captain.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');
            const remove = interaction.options.getBoolean('remove') ?? false;

            return await runSetViceCaptain({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                remove,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setvicecaptain] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to set vice captain.');
            }

            return interaction.reply({
                content: '❌ Failed to set vice captain.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runSetViceCaptain({
    guild,
    actorId,
    targetUser,
    remove,
    reply
}) {
    // ── CHECK PERMISSIONS ──
    const organizer = await isOrganizer(guild.id, actorId);

    let team = null;
    let isTeamCaptain = false;

    if (!organizer) {
        // Must be captain to set vice captain
        const captainPlayer = await Player.findOne({
            guildId: guild.id,
            discordID: actorId
        }).populate('teamId');

        if (!captainPlayer?.teamId) {
            return reply({
                content: '❌ You are not linked to any team.'
            });
        }

        team = captainPlayer.teamId;

        if (
            String(team.captainID) !== String(actorId) &&
            !captainPlayer.isCaptain
        ) {
            return reply({
                content: '❌ Only the team captain or an organizer can set the vice captain.'
            });
        }

        isTeamCaptain = true;
    } else {
        // Organizer — find team by target user
        if (remove) {
            // For remove, we need to know which team
            // Try to find the team where the target is vice captain
            team = await Team.findOne({
                guildId: guild.id,
                viceCaptainID: targetUser.id
            });

            if (!team) {
                // Fallback: find team the target is in
                const targetPlayer = await Player.findOne({
                    guildId: guild.id,
                    discordID: targetUser.id
                });

                if (!targetPlayer?.teamId) {
                    return reply({
                        content: `❌ ${targetUser} is not registered as a player in any team.`
                    });
                }

                team = await Team.findById(targetPlayer.teamId);
            }
        } else {
            // Find the team the target is in
            const targetPlayer = await Player.findOne({
                guildId: guild.id,
                discordID: targetUser.id
            });

            if (!targetPlayer?.teamId) {
                return reply({
                    content: `❌ ${targetUser} is not registered as a player in any team.`
                });
            }

            team = await Team.findById(targetPlayer.teamId);
        }
    }

    if (!team) {
        return reply({
            content: '❌ Could not find a team.'
        });
    }

    // ── REMOVE MODE ──
    if (remove) {
        if (!team.viceCaptainID) {
            return reply({
                content: `❌ **${team.name}** does not have a vice captain set.`
            });
        }

        await Team.updateOne(
            { _id: team._id },
            { $set: { viceCaptainID: null } }
        );

        // Clear isViceCaptain for all players in this team
        await Player.updateMany(
            {
                guildId: guild.id,
                teamId: team._id
            },
            { $set: { isViceCaptain: false } }
        );

        await TournamentPlayer.updateMany(
            {
                guildId: guild.id,
                teamId: team._id
            },
            { $set: { isViceCaptain: false } }
        );

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🗑️ VICE CAPTAIN REMOVED')
            .setDescription(
                `Team: **${team.name}**\n\n` +
                `Vice captain role has been removed.`
            )
            .setTimestamp();

        return reply({ embeds: [embed] });
    }

    // ── SET MODE ──

    // Can't set yourself as vice captain if you're the captain
    if (String(team.captainID) === String(targetUser.id)) {
        return reply({
            content: '❌ The captain cannot also be the vice captain. Choose another team member.'
        });
    }

    // Target must be a registered player
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    // Target must be on the same team
    if (!targetPlayer.teamId || String(targetPlayer.teamId) !== String(team._id)) {
        return reply({
            content:
                `❌ ${targetUser} is not in **${team.name}**.\n` +
                'Vice captain must be a member of the same team.'
        });
    }

    // ── UPDATE DATABASE ──

    // Clear old vice captain flags
    await Player.updateMany(
        {
            guildId: guild.id,
            teamId: team._id
        },
        { $set: { isViceCaptain: false } }
    );

    await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            teamId: team._id
        },
        { $set: { isViceCaptain: false } }
    );

    // Set new vice captain
    await Team.updateOne(
        { _id: team._id },
        { $set: { viceCaptainID: targetUser.id } }
    );

    await Player.updateOne(
        { _id: targetPlayer._id },
        { $set: { isViceCaptain: true } }
    );

    await TournamentPlayer.updateMany(
        {
            guildId: guild.id,
            playerId: targetPlayer._id
        },
        { $set: { isViceCaptain: true } }
    );

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🥈 VICE CAPTAIN SET')
        .setDescription(
            `Team: **${team.name}**\n\n` +
            `Vice Captain: ${targetUser}\n` +
            `Set by: ${organizer ? 'Organizer' : 'Captain'}`
        )
        .setFooter({
            text: 'The vice captain has all team management permissions.'
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}
