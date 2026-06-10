/**
 * nick.js
 *
 * Change a player's registered name in the database.
 * Captain or vice captain can rename any teammate.
 *
 * Updates:
 *   - Player.name
 *   - TournamentPlayer.playerNameSnapshot (across all active tournaments)
 *
 * Usage:
 *   .nick @user New Player Name
 *   .nick Cool Striker => Amazing Striker    (organizer format)
 *
 * Slash: /playernick user:@user name:New Name
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'nick',
    description: 'Change a player\'s registered name.',
    usage: '.nick @user <new name>',
    aliases: ['playernick', 'pname', 'renameplayer'],
    hidden: true,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('playernick')
        .setDescription('Change a player\'s registered name')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Teammate to rename')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('name')
                .setDescription('New player name')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const target =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!target) {
                return message.reply(
                    '❓ Usage: `.nick @user <new name>`'
                );
            }

            // Get new name from args after the mention
            const cleanContent = message.content.replace(/<@!?\d+>/g, '').trim();
            const parts = cleanContent.split(/\s+/);
            const nameParts = parts.filter(
                arg => !arg.startsWith('.')
            );
            const newName = nameParts.join(' ').trim();

            if (!newName || newName.length < 2) {
                return message.reply(
                    '❓ Usage: `.nick @user <new name>`\n' +
                    'Name must be at least 2 characters.'
                );
            }

            if (newName.length > 40) {
                return message.reply(
                    '❌ Player name is too long. Keep it under 40 characters.'
                );
            }

            return await runNick({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                newName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('nick prefix error:', error);
            return message.reply('❌ Failed to change player name.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');
            const newName = interaction.options.getString('name').trim();

            if (!newName || newName.length < 2) {
                return interaction.editReply('❌ Name must be at least 2 characters.');
            }

            if (newName.length > 40) {
                return interaction.editReply('❌ Name is too long. Keep it under 40 characters.');
            }

            return await runNick({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                newName,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('nick slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change player name.');
            }

            return interaction.reply({
                content: '❌ Failed to change player name.',
                ephemeral: true
            });
        }
    }
};

/*
========================================
CORE LOGIC
========================================
*/

async function runNick({
    guild,
    actorId,
    targetUser,
    newName,
    reply
}) {
    // ── FIND ACTOR ──
    const actorPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    });

    const organizer = await isOrganizer(guild.id, actorId);

    // ── FIND TARGET PLAYER ──
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    }).populate('teamId');

    if (!targetPlayer) {
        return reply({
            content: `❌ ${targetUser} is not registered as a player.`
        });
    }

    // ── PERMISSION CHECK ──
    if (!organizer) {
        if (!actorPlayer?.teamId) {
            return reply({
                content: '❌ You are not linked to any team.'
            });
        }

        const team = actorPlayer.teamId;

        // Actor must be captain or vice captain
        const isCaptain =
            String(team.captainID) === String(actorId) ||
            actorPlayer.isCaptain;

        const isViceCaptain =
            String(team.viceCaptainID) === String(actorId) ||
            actorPlayer.isViceCaptain;

        if (!isCaptain && !isViceCaptain) {
            return reply({
                content: '❌ Only the team captain, vice captain, or an organizer can change player names.'
            });
        }

        // Target must be on the same team
        if (
            !targetPlayer.teamId ||
            String(targetPlayer.teamId) !== String(team._id)
        ) {
            return reply({
                content: `❌ ${targetUser} is not in **${team.name}**. You can only rename your own teammates.`
            });
        }
    }

    // ── STORE OLD NAME ──
    const oldName = targetPlayer.name;

    if (oldName === newName) {
        return reply({
            content: '❌ The new name is the same as the current name.'
        });
    }

    // ── UPDATE PLAYER COLLECTION ──
    await Player.updateOne(
        { _id: targetPlayer._id },
        { $set: { name: newName } }
    );

    // ── UPDATE TOURNAMENT PLAYER COLLECTIONS ──
    const activeTournaments = await TournamentSettings.find({
        guildId: guild.id,
        currentPhase: { $ne: 'completed' }
    }).select('_id').lean();

    const activeTournamentIds = activeTournaments.map(t => t._id);

    let tournamentPlayersUpdated = 0;

    if (activeTournamentIds.length) {
        const tpResult = await TournamentPlayer.updateMany(
            {
                guildId: guild.id,
                tournamentId: { $in: activeTournamentIds },
                playerId: targetPlayer._id,
                isActive: true
            },
            {
                $set: { playerNameSnapshot: newName }
            }
        );

        tournamentPlayersUpdated = tpResult.modifiedCount || 0;
    }

    // ── CONFIRM ──
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏷️ PLAYER NAME CHANGED')
        .setDescription(
            `**${oldName}** → **${newName}**\n\n` +
            `Player: ${targetUser}\n` +
            `Changed by: ${organizer ? 'Organizer' : 'Captain/Vice Captain'}\n` +
            `Tournament records updated: **${tournamentPlayersUpdated}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/*
========================================
HELPERS
========================================
*/

async function getUserFromArgs(message) {
    const rawId = message.content.match(/\d{17,20}/)?.[0];
    if (!rawId) return null;

    return message.client.users.fetch(rawId).catch(() => null);
}
