const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const { Player, Team, TournamentSettings } = require('../../models/Tournament');
const { syncPlayerToOpenTournaments } = require('../../utils/tournamentSync');

module.exports = {
    name: 'addplayer',
    description: 'Add a player to your global team.',
    usage: '.addplayer @user Player Name',
    aliases: ['ap'],

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
                .setDescription('Player display name')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target = message.mentions.users.first();
            const customName = args.slice(1).join(' ').trim();

            if (!target || !customName) {
                return message.reply('❓ Usage: `.addplayer @User Player Name`');
            }

            return await runAddPlayer({
                guild: message.guild,
                captainUserId: message.author.id,
                targetUserId: target.id,
                customName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('addplayer prefix error:', error);
            return message.reply('❌ Failed to add player.');
        }
    },

    async slashExecute(interaction) {
        try {
            const target = interaction.options.getUser('user');
            const customName = interaction.options.getString('player_name');

            return await runAddPlayer({
                guild: interaction.guild,
                captainUserId: interaction.user.id,
                targetUserId: target.id,
                customName,
                reply: payload => interaction.reply(payload)
            });
        } catch (error) {
            console.error('addplayer slash error:', error);

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

async function runAddPlayer({
    guild,
    captainUserId,
    targetUserId,
    customName,
    reply
}) {
    const cleanName = customName.trim();

    if (!cleanName || cleanName.length < 2) {
        return reply({ content: '❌ Please provide a valid player name.' });
    }

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

    if (targetUserId === captainUserId) {
        return reply({ content: '❌ You are already the captain/player of this team.' });
    }

    const existing = await Player.findOne({
        guildId: guild.id,
        discordID: targetUserId
    });

    if (existing) {
        return reply({
            content: `❌ This user is already registered as **${existing.name}**.`
        });
    }

    const captainConflict = await Team.findOne({
        guildId: guild.id,
        captainID: targetUserId
    });

    if (captainConflict) {
        return reply({
            content: `❌ This user is already captain of **${captainConflict.name}**.`
        });
    }

    const player = await Player.create({
        guildId: guild.id,
        name: cleanName,
        discordID: targetUserId,
        teamId: team._id,
        teamNameSnapshot: team.name,
        isCaptain: false
    });

    const sync = await syncPlayerToOpenTournaments(guild.id, player);

    const newestSettings = await TournamentSettings.findOne({
        guildId: guild.id,
        registrationOpen: true,
        currentPhase: 'registration'
    }).sort({ createdAt: -1 });

    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

    const playerRoleResult = await tryAssignRole({
        guild,
        member: targetMember,
        roleId: newestSettings?.tournamentPlayerRoleId || ''
    });

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
                value: buildRoleStatusText(playerRoleResult),
                inline: false
            }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

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