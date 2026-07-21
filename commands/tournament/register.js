/**
 * register.js
 *
 * Register a new global team. Creates the Team + captain Player record,
 * syncs to open tournaments, and assigns captain/player roles.
 *
 * Usage:  .register <Team Name>
 * Slash:  /register team_name:<name>
 *
 * Aliases: reg
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentSettings
} = require('../../models/Tournament');

const { syncTeamToOpenTournaments } = require('../../utils/tournamentSync');
const { escapeRegex } = require('../../utils/stringHelpers');

module.exports = {
    name: 'register',
    description: 'Register a global team.',
    usage: '.register <Team Name>',
    aliases: ['reg'],
    hidden: false,
    cooldown: 10,

    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your global team')
        .addStringOption(opt =>
            opt.setName('team_name')
                .setDescription('Your team name')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!args.length) {
                return message.reply('❓ Usage: `.register <Team Name>`');
            }

            return await runRegister({
                guild: message.guild,
                member: message.member,
                user: message.author,
                teamNameInput: args.join(' ').trim(),
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[register] prefix error:', error);
            return message.reply('❌ Failed to register team.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            return await runRegister({
                guild: interaction.guild,
                member: interaction.member,
                user: interaction.user,
                teamNameInput: interaction.options.getString('team_name'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[register] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to register team.');
            }

            return interaction.reply({ content: '❌ Failed to register team.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Register a new team:
 * 1. Validate name uniqueness
 * 2. Ensure user isn't already a captain
 * 3. Create Team + captain Player
 * 4. Sync to open tournaments
 * 5. Assign Discord roles
 */
async function runRegister({ guild, member, user, teamNameInput, reply }) {
    const teamName = teamNameInput?.trim();

    if (!teamName || teamName.length < 2) {
        return reply({ content: '❌ Please provide a valid team name.' });
    }

    /* ── Check if user already manages a team ── */
    const existingCaptainTeam = await Team.findOne({
        guildId: guild.id,
        captainID: user.id
    });

    if (existingCaptainTeam) {
        return reply({ content: `❌ You already manage **${existingCaptainTeam.name}**.` });
    }

    /* ── Check name uniqueness ── */
    const existingName = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (existingName) {
        return reply({ content: `❌ A team named **${existingName.name}** already exists.` });
    }

    /* ── Check if user is already on a team ── */
    const existingPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: user.id
    }).populate('teamId');

    const isFreeAgent =
        existingPlayer &&
        (
            !existingPlayer.teamId ||
            String(existingPlayer.teamNameSnapshot || '').toUpperCase() === 'FREE AGENT'
        );

    if (existingPlayer && !isFreeAgent) {
        const linkedTeamName =
            existingPlayer.teamId?.name ||
            existingPlayer.teamNameSnapshot ||
            'another team';

        return reply({
            content:
                `❌ You are already registered as **${existingPlayer.name}** ` +
                `in **${linkedTeamName}**.`
        });
    }

    /* ── Create team ── */
    const createdTeam = await Team.create({
        guildId: guild.id,
        name: teamName,
        captainID: user.id,
        groupKey: null,
        stats: {
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            gf: 0,
            ga: 0,
            points: 0
        }
    });

    /* ── Create or update captain player record ── */
    let captainPlayer;

    if (existingPlayer && isFreeAgent) {
        captainPlayer = await Player.findOneAndUpdate(
            { _id: existingPlayer._id },
            {
                $set: {
                    name: existingPlayer.name || member?.displayName || user.username,
                    teamId: createdTeam._id,
                    teamNameSnapshot: createdTeam.name,
                    isCaptain: true,
                    isViceCaptain: false
                }
            },
            { new: true }
        );
    } else {
        captainPlayer = await Player.create({
            guildId: guild.id,
            name: member?.displayName || user.username,
            discordID: user.id,
            discordUsername: user.username?.toLowerCase() || null,
            teamId: createdTeam._id,
            teamNameSnapshot: createdTeam.name,
            isCaptain: true,
            isViceCaptain: false,
            stats: {
                played: 0,
                goals: 0,
                assists: 0,
                saves: 0,
                tackles: 0,
                interceptions: 0,
                yc: 0,
                rc: 0,
                mvps: 0
            }
        });
    }

    /* ── Sync to open tournaments ── */
    const sync = await syncTeamToOpenTournaments(guild.id, createdTeam);

    /* ── Assign Discord roles ── */
    const newestSettings = await TournamentSettings.findOne({
        guildId: guild.id,
        $or: [
            { registrationOpen: true },
            { currentPhase: { $in: ['registration', 'league', 'groups', 'knockout'] } }
        ]
    }).sort({ createdAt: -1 });

    const captainRoleResult = await tryAssignRole({
        guild,
        member,
        roleId: newestSettings?.captainRoleId || ''
    });

    const playerRoleResult = await tryAssignRole({
        guild,
        member,
        roleId: newestSettings?.tournamentPlayerRoleId || ''
    });

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ TEAM REGISTERED')
        .setDescription(
            `**${createdTeam.name}** has been registered globally.\n` +
            `👑 Captain: ${user}\n` +
            `🧍 Captain Profile: **${captainPlayer.name}**`
        )
        .addFields(
            {
                name: 'Tournament Sync',
                value:
                    `Added to open tournaments: **${sync.syncedTournaments}**\n` +
                    `Players synced: **${sync.syncedPlayers}**`,
                inline: false
            },
            {
                name: 'Captain Role',
                value: buildRoleStatusText(captainRoleResult),
                inline: false
            },
            {
                name: 'Player Role',
                value: buildRoleStatusText(playerRoleResult),
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   ROLE HELPERS
==================================================== */

/** Attempt to assign a Discord role with full permission/hierarchy checks. */
async function tryAssignRole({ guild, member, roleId }) {
    if (!roleId) return { status: 'not_configured' };
    if (!member) return { status: 'member_missing' };

    const role = guild.roles.cache.get(roleId);
    if (!role) return { status: 'role_missing' };

    const botMember = guild.members.me;
    if (!botMember) return { status: 'bot_member_missing', role };

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

/** Human-readable status for the role assignment attempt. */
function buildRoleStatusText(result) {
    const messages = {
        assigned: `Assigned: <@&${result.role.id}>`,
        already_has_role: `Already has: <@&${result.role.id}>`,
        not_configured: 'Not configured',
        role_missing: 'Configured role missing',
        missing_manage_roles: `Bot lacks Manage Roles for <@&${result.role.id}>`,
        role_too_high: `Role too high: <@&${result.role.id}>`,
        managed_role: 'Managed role cannot be assigned',
        member_missing: 'Member not found',
        bot_member_missing: 'Bot member missing',
        assign_failed: `Failed to assign: <@&${result.role.id}>`
    };

    return messages[result.status] || 'Unknown';
}
