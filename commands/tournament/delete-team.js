const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    Fixture,
    TournamentTeam,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'delete-team',
    description: 'Safely remove a team and make its players free agents.',
    usage: '.delete-team <team name> confirm',
    aliases: ['deleteteam', 'removeteam', 'dt'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('delete-team')
        .setDescription('Safely remove a team and make its players free agents')
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addBooleanOption(opt =>
            opt.setName('confirm')
                .setDescription('Required confirmation')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const confirm = args[args.length - 1]?.toLowerCase() === 'confirm';
            const teamName = args.slice(0, -1).join(' ').trim();

            if (!teamName || !confirm) {
                return message.reply('⚠️ Use `.delete-team <team name> confirm` to proceed.');
            }

            return await runDeleteTeam({
                guild: message.guild,
                teamName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('delete-team prefix error:', error);
            return message.reply('❌ Failed to remove team.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            if (!interaction.options.getBoolean('confirm')) {
                return interaction.editReply('⚠️ You must set confirm to true.');
            }

            return await runDeleteTeam({
                guild: interaction.guild,
                teamName: interaction.options.getString('team'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('delete-team slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to remove team.');
            }

            return interaction.reply({
                content: '❌ Failed to remove team.',
                ephemeral: true
            });
        }
    }
};

async function runDeleteTeam({
    guild,
    teamName,
    reply
}) {
    const team = await Team.findOne({
        guildId: guild.id,
        name: {
            $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
        }
    });

    if (!team) {
        return reply({
            content: `❌ Team not found: \`${teamName}\``
        });
    }

    const oldTeamName = team.name;

    const players = await Player.find({
        guildId: guild.id,
        teamId: team._id
    });

    const playerIds = players.map(player => player._id);
    const playerDiscordIds = players
        .map(player => player.discordID)
        .filter(Boolean);

    const activeTournaments = await TournamentSettings.find({
        guildId: guild.id,
        currentPhase: {
            $ne: 'completed'
        }
    }).lean();

    const activeTournamentIds = activeTournaments.map(tournament => tournament._id);

    let tournamentTeamsUpdated = 0;
    let tournamentPlayersUpdated = 0;
    let fixturesCancelled = 0;

    if (activeTournamentIds.length) {
        const tournamentTeamUpdate = await TournamentTeam.updateMany(
            {
                guildId: guild.id,
                tournamentId: {
                    $in: activeTournamentIds
                },
                teamId: team._id
            },
            {
                $set: {
                    isActive: false,
                    removedAt: new Date()
                }
            }
        );

        tournamentTeamsUpdated = tournamentTeamUpdate.modifiedCount || 0;

        if (playerIds.length) {
            const tournamentPlayerUpdate = await TournamentPlayer.updateMany(
                {
                    guildId: guild.id,
                    tournamentId: {
                        $in: activeTournamentIds
                    },
                    playerId: {
                        $in: playerIds
                    }
                },
                {
                    $set: {
                        teamId: null,
                        tournamentTeamId: null,
                        teamNameSnapshot: 'FREE AGENT',
                        isCaptain: false
                    }
                }
            );

            tournamentPlayersUpdated = tournamentPlayerUpdate.modifiedCount || 0;
        }

        const fixtureUpdate = await Fixture.updateMany(
            {
                guildId: guild.id,
                tournamentId: {
                    $in: activeTournamentIds
                },
                status: {
                    $ne: 'Played'
                },
                $or: [
                    { homeTeamId: team._id },
                    { awayTeamId: team._id },
                    { homeTeam: oldTeamName },
                    { awayTeam: oldTeamName }
                ]
            },
            {
                $set: {
                    status: 'Cancelled',
                    notes: `Cancelled because ${oldTeamName} was removed.`
                }
            }
        );

        fixturesCancelled = fixtureUpdate.modifiedCount || 0;
    }

    await Player.updateMany(
        {
            guildId: guild.id,
            teamId: team._id
        },
        {
            $set: {
                teamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false
            }
        }
    );

    await removeTeamRoles({
        guild,
        playerDiscordIds,
        captainId: team.captainID
    });

    await Team.deleteOne({
        _id: team._id
    });

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🗑️ Team Removed')
        .setDescription(
            `**${oldTeamName}** has been removed.\n\n` +
            `Players are now **FREE AGENTS**.\n` +
            `Stats were **not deleted**.`
        )
        .setFooter({
            text:
                `Players moved: ${players.length} • ` +
                `Fixtures cancelled: ${fixturesCancelled}`
        })
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}

async function removeTeamRoles({
    guild,
    playerDiscordIds,
    captainId
}) {
    const settings = await TournamentSettings.find({
        guildId: guild.id
    }).lean().catch(() => []);

    const captainRoleIds = [
        ...new Set(
            settings
                .map(setting => setting.captainRoleId)
                .filter(Boolean)
        )
    ];

    const playerRoleIds = [
        ...new Set(
            settings
                .map(setting => setting.tournamentPlayerRoleId)
                .filter(Boolean)
        )
    ];

    const allPlayerIds = [...new Set(playerDiscordIds.map(String))];

    for (const userId of allPlayerIds) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        for (const roleId of playerRoleIds) {
            await removeRoleSafely(member, roleId);
        }
    }

    if (captainId) {
        const captainMember = await guild.members.fetch(captainId).catch(() => null);

        if (captainMember) {
            for (const roleId of captainRoleIds) {
                await removeRoleSafely(captainMember, roleId);
            }
        }
    }
}

async function removeRoleSafely(member, roleId) {
    if (!roleId) return;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) return;

    const botMember = member.guild.members.me;
    if (!botMember) return;

    if (!botMember.permissions.has('ManageRoles')) return;
    if (role.managed) return;
    if (botMember.roles.highest.position <= role.position) return;
    if (!member.roles.cache.has(role.id)) return;

    await member.roles.remove(role).catch(() => null);
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}