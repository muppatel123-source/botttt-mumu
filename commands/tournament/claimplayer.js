const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer
} = require('../../models/Tournament');

module.exports = {
    name: 'claimplayer',
    description: 'Sign a free agent to your team as captain.',
    usage: '.claimplayer @user',
    aliases: ['sign', 'signplayer'],
    hidden: true,
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

    async execute(message) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

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
            console.error('claimplayer prefix error:', error);
            return message.reply('❌ Failed to claim player.');
        }
    },

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
            console.error('claimplayer slash error:', error);

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

async function runClaimPlayer({
    guild,
    actorId,
    targetUser,
    reply
}) {
    const captainPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!captainPlayer?.teamId) {
        return reply({
            content: '❌ You are not linked to any team.'
        });
    }

    const team = captainPlayer.teamId;

    if (String(team.captainID) !== String(actorId) && !captainPlayer.isCaptain) {
        return reply({
            content: '❌ Only the team captain can claim free agents.'
        });
    }

    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    if (targetPlayer.teamId) {
        return reply({
            content:
                `❌ ${targetUser} is not a free agent.\n` +
                'Use `.transfer @user` if the player belongs to another team.'
        });
    }

    await Player.updateOne(
        { _id: targetPlayer._id },
        {
            $set: {
                teamId: team._id,
                teamNameSnapshot: team.name,
                isCaptain: false
            }
        }
    );

    const updatedTournamentPlayers = await assignPlayerToActiveTournaments({
        guildId: guild.id,
        playerId: targetPlayer._id,
        team
    });

const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ Player Signed')
    .setDescription(`${targetUser} has joined **${team.name}**.`)
    .setTimestamp();

    return reply({ embeds: [embed] });
}

async function assignPlayerToActiveTournaments({
    guildId,
    playerId,
    team
}) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: {
            $ne: 'completed'
        }
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
                    isCaptain: false
                }
            }
        );

        updated += result.modifiedCount || 0;
    }

    return updated;
}

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}