/**
 * addplayer.js
 *
 * Add a new player to your global team.
 * Captain or Vice Captain only. Creates a global Player record,
 * syncs to active tournaments, and optionally assigns the tournament player role.
 *
 * If no player name is given, the Discord username is used automatically.
 *
 * Usage: .addplayer @user [Player Name]
 * Slash: /addplayer user:<user> [player_name:<name>]
 *
 * Aliases: ap
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Player, Team, TournamentSettings } = require('../../models/Tournament');
const { syncPlayerToOpenTournaments } = require('../../utils/tournamentSync');
const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'addplayer',
    description: 'Add a player to your global team.',
    usage: '.addplayer @user [Player Name]',
    aliases: ['ap'],
    hidden: false,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('addplayer')
        .setDescription('Add a player to your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to add')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('player_name')
                .setDescription('Player display name (defaults to Discord username)')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target = message.mentions.users.first()
                || await getUserFromArgs(message, args);

            if (!target) {
                return message.reply('❓ Usage: `.addplayer @user [Player Name]`');
            }

            // Build custom name: strip mention tokens from args, join the rest
            const cleanArgs = args
                .map(a => a.replace(/<@!?\d+>/, '').trim())
                .filter(Boolean);
            const customName = cleanArgs.join(' ').trim() || null;

            return await runAddPlayer({
                guild: message.guild,
                captainUserId: message.author.id,
                targetUser: target,
                customName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[addplayer] prefix error:', error);
            return message.reply('❌ Failed to add player.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('user');
            const customName = interaction.options.getString('player_name') || null;

            return await runAddPlayer({
                guild: interaction.guild,
                captainUserId: interaction.user.id,
                targetUser: target,
                customName,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[addplayer] slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to add player.');
            }

            return interaction.reply({
                content: '❌ Failed to add player.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Add a new player to a team.
 * Validates: name length, actor is captain/VC, target not already registered,
 * target is not a captain of another team.
 */
async function runAddPlayer({ guild, captainUserId, targetUser, customName, reply }) {
    const targetUserId = targetUser.id;

    /* ── Resolve player name: custom or Discord username ── */
    const cleanName = (customName && customName.trim()) || targetUser.username || 'Unknown';

    if (cleanName.length < 2) {
        return reply({ content: '❌ Please provide a valid player name (at least 2 characters).' });
    }

    // ── Find actor's team (captain or VC) ──
    let team = await Team.findOne({
        guildId: guild.id,
        captainID: captainUserId
    });

    if (!team) {
        team = await Team.findOne({
            guildId: guild.id,
            viceCaptainID: captainUserId
        });
    }

    if (!team) {
        return reply({ content: '🚫 Only team captains or vice captains can add players.' });
    }

    // ── Self-add check ──
    if (targetUserId === captainUserId) {
        return reply({ content: '❌ You are already the captain/player of this team.' });
    }

    // ── Check if user is already registered ──
    const existing = await Player.findOne({
        guildId: guild.id,
        discordID: targetUserId
    });

    if (existing) {
        return reply({
            content: `❌ This user is already registered as **${existing.name}**.`
        });
    }

    // ── Check if user is captain of another team ──
    const captainConflict = await Team.findOne({
        guildId: guild.id,
        captainID: targetUserId
    });

    if (captainConflict) {
        return reply({
            content: `❌ This user is already captain of **${captainConflict.name}**.`
        });
    }

    // ── Create player ──
    const player = await Player.create({
        guildId: guild.id,
        name: cleanName,
        discordID: targetUserId,
        discordUsername: targetUser.username?.toLowerCase() || null,
        teamId: team._id,
        teamNameSnapshot: team.name,
        isCaptain: false,
        isViceCaptain: false
    });

    // ── Sync to active tournaments ──
    const sync = await syncPlayerToOpenTournaments(guild.id, player);

    // ── Assign tournament player role ──
    const newestSettings = await TournamentSettings.findOne({
        guildId: guild.id,
        $or: [
            { registrationOpen: true },
            { currentPhase: { $in: ['registration', 'league', 'groups', 'knockout'] } }
        ]
    }).sort({ createdAt: -1 });

    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    const roleResult = await tryAssignRole({
        guild,
        member: targetMember,
        roleId: newestSettings?.tournamentPlayerRoleId || ''
    });

    // ── Response ──
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🏃 PLAYER ADDED')
        .setDescription(
            `**${player.name}** has joined **${team.name}** globally.\n` +
            `👤 Linked to: <@${targetUserId}>`
        )
        .addFields(
            {
                name: 'Tournament Sync',
                value: `Added to active tournament entries: **${sync.syncedTournaments}**`,
                inline: false
            },
            {
                name: 'Tournament Player Role',
                value: buildRoleStatusText(roleResult),
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   ROLE ASSIGNMENT
==================================================== */

/**
 * Attempt to assign a tournament player role to a member.
 * Checks all permission and hierarchy conditions before assigning.
 */
async function tryAssignRole({ guild, member, roleId }) {
    if (!roleId) return { status: 'not_configured' };
    if (!member) return { status: 'member_missing' };

    const role = guild.roles.cache.get(roleId);
    if (!role) return { status: 'role_missing' };

    const botMember = guild.members.me;
    if (!botMember) return { status: 'bot_member_missing' };

    if (!botMember.permissions.has('ManageRoles')) return { status: 'missing_manage_roles', role };
    if (member.roles.cache.has(role.id)) return { status: 'already_has_role', role };
    if (role.managed) return { status: 'managed_role', role };
    if (botMember.roles.highest.position <= role.position) return { status: 'role_too_high', role };

    try {
        await member.roles.add(role);
        return { status: 'assigned', role };
    } catch {
        return { status: 'assign_failed', role };
    }
}

/**
 * Build a human-readable status string for the role assignment result.
 */
function buildRoleStatusText(result) {
    switch (result.status) {
        case 'assigned': return `Assigned: <@&${result.role.id}>`;
        case 'already_has_role': return `Already has: <@&${result.role.id}>`;
        case 'not_configured': return 'Not configured';
        case 'role_missing': return 'Configured role missing';
        case 'missing_manage_roles': return `Bot lacks Manage Roles for <@&${result.role.id}>`;
        case 'role_too_high': return `Role too high: <@&${result.role.id}>`;
        case 'managed_role': return 'Managed role cannot be assigned';
        case 'member_missing': return 'Member not found';
        case 'assign_failed': return `Failed to assign: <@&${result.role.id}>`;
        default: return 'Unknown';
    }
}
