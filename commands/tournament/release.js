/**
 * release.js
 *
 * Release a player from your team as captain. Makes them a free agent.
 * Cannot release yourself (change captain first). Cannot release captains.
 *
 * Usage:  .release @user
 * Slash:  /release user:<user>
 *
 * Aliases: dropplayer, kickplayer
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    TournamentSettings,
    ServerConfig
} = require('../../models/Tournament');

const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'release',
    description: 'Release a player from your team as captain.',
    usage: '.release @user',
    aliases: ['dropplayer', 'kickplayer'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('release')
        .setDescription('Release a player from your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player to release')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.release @user`');
            }

            return await runRelease({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[release] prefix error:', error);
            return message.reply('❌ Failed to release player.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const target = interaction.options.getUser('user');

            return await runRelease({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[release] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to release player.');
            }

            return interaction.reply({ content: '❌ Failed to release player.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Release a player from the captain's team:
 * 1. Validate actor is captain
 * 2. Validate target is on the same team and not captain
 * 3. Update global Player record
 * 4. Update all active TournamentPlayer entries
 */
async function runRelease({ guild, actorId, targetUser, reply }) {
    // ── Transfer lock check ──
    const config = await ServerConfig.findOne({ guildId: guild.id }).lean();
    if (config?.transfersLocked) {
        return reply({ content: '🔒 Transfers are **locked**. The transfer window is currently closed.' });
    }

    /* ── Find actor's team ── */
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

    if (!isCaptain) {
        return reply({ content: '❌ Only the team captain can release players.' });
    }

    /* ── Can't release yourself ── */
    if (String(actorId) === String(targetUser.id)) {
        return reply({
            content:
                '❌ You cannot release yourself while you are captain.\n' +
                'Use `.cc @newCaptain` first.'
        });
    }

    /* ── Find target player ── */
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    if (!targetPlayer.teamId || String(targetPlayer.teamId) !== String(team._id)) {
        return reply({ content: `❌ ${targetUser} is not in **${team.name}**.` });
    }

    /* ── Can't release the captain ── */
    if (targetPlayer.isCaptain || String(team.captainID) === String(targetUser.id)) {
        return reply({
            content:
                `❌ ${targetUser} is the captain of **${team.name}**.\n` +
                'Use `.cc @newCaptain` first.'
        });
    }

    /* ── Update global player record ── */
    await Player.updateOne(
        { _id: targetPlayer._id },
        {
            $set: {
                teamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    /* ── Update active tournament entries ── */
    const updatedTournamentPlayers = await makePlayerFreeAgent({
        guildId: guild.id,
        playerId: targetPlayer._id
    });

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x95A5A6)
        .setTitle('✅ Player Released')
        .setDescription(
            `${targetUser} has been released from **${team.name}**.\n` +
            `They are now a **FREE AGENT**.`
        )
        .setFooter({
            text: `Tournament records updated: ${updatedTournamentPlayers}`
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   TOURNAMENT SYNC
==================================================== */

/** Make a player a free agent across all active tournaments. */
async function makePlayerFreeAgent({ guildId, playerId }) {
    const activeTournaments = await TournamentSettings.find({
        guildId,
        currentPhase: { $ne: 'completed' }
    }).select('_id').lean();

    const activeTournamentIds = activeTournaments.map(t => t._id);

    if (!activeTournamentIds.length) return 0;

    const result = await TournamentPlayer.updateMany(
        {
            guildId,
            playerId,
            tournamentId: { $in: activeTournamentIds },
            isActive: true
        },
        {
            $set: {
                teamId: null,
                tournamentTeamId: null,
                teamNameSnapshot: 'FREE AGENT',
                isCaptain: false,
                isViceCaptain: false
            }
        }
    );

    return result.modifiedCount || 0;
}
