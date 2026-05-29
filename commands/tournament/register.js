const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const {
    Team,
    Player,
    TournamentSettings
} = require('../../models/Tournament');

const { syncTeamToOpenTournaments } = require('../../utils/tournamentSync');

module.exports = {
    name: 'register',
    description: 'Register a global team.',
    usage: '.register <Team Name>',
    aliases: ['reg'],

    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your global team')
        .addStringOption(opt =>
            opt.setName('team_name')
                .setDescription('Your team name')
                .setRequired(true)
        ),

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
            console.error('register prefix error:', error);
            return message.reply('❌ Failed to register team.');
        }
    },

    async slashExecute(interaction) {
        try {
            return await runRegister({
                guild: interaction.guild,
                member: interaction.member,
                user: interaction.user,
                teamNameInput: interaction.options.getString('team_name'),
                reply: payload => interaction.reply(payload)
            });
        } catch (error) {
            console.error('register slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to register team.');
            }

            return interaction.reply({
                content: '❌ Failed to register team.',
                ephemeral: true
            });
        }
    }
};

async function runRegister({ guild, member, user, teamNameInput, reply }) {
    const teamName = teamNameInput?.trim();

    if (!teamName || teamName.length < 2) {
        return reply({ content: '❌ Please provide a valid team name.' });
    }

    const existingCaptainTeam = await Team.findOne({
        guildId: guild.id,
        captainID: user.id
    });

    if (existingCaptainTeam) {
        return reply({ content: `❌ You already manage **${existingCaptainTeam.name}**.` });
    }

    const existingName = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (existingName) {
        return reply({ content: `❌ A team named **${existingName.name}** already exists.` });
    }

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

    let captainPlayer;

    if (existingPlayer && isFreeAgent) {
        captainPlayer = await Player.findOneAndUpdate(
            { _id: existingPlayer._id },
            {
                $set: {
                    name: existingPlayer.name || member?.displayName || user.username,
                    teamId: createdTeam._id,
                    teamNameSnapshot: createdTeam.name,
                    isCaptain: true
                }
            },
            {
                new: true
            }
        );
    } else {
        captainPlayer = await Player.create({
            guildId: guild.id,
            name: member?.displayName || user.username,
            discordID: user.id,
            teamId: createdTeam._id,
            teamNameSnapshot: createdTeam.name,
            isCaptain: true,
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

    const sync = await syncTeamToOpenTournaments(guild.id, createdTeam);

    const newestSettings = await TournamentSettings.findOne({
        guildId: guild.id,
        registrationOpen: true,
        currentPhase: 'registration'
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
        case 'managed_role': return `Managed role cannot be assigned`;
        case 'member_missing': return 'Member not found';
        case 'assign_failed': return `Failed to assign: <@&${result.role.id}>`;
        default: return 'Unknown';
    }
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}
