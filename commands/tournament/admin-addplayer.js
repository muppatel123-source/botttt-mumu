/**
 * admin-addplayer.js
 *
 * Organizer command to add a global player to any team.
 * Optionally syncs the player to active tournaments.
 *
 * Usage: .admin-addplayer <team name> @user <player display name>
 * Slash: /admin-addplayer team:<name> user:<user> player_name:<name>
 *
 * Aliases: forceaddplayer, aap
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { Player, Team } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');
const { syncPlayerToOpenTournaments } = require('../../utils/tournamentSync');
const { escapeRegex, getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'admin-addplayer',
    description: 'Add a global player to any team as an organizer.',
    usage: '.admin-addplayer <team name> @user <player display name>',
    aliases: ['forceaddplayer', 'aap'],
    hidden: false,
    cooldown: 3,
    userPermissions: [],

    data: new SlashCommandBuilder()
        .setName('admin-addplayer')
        .setDescription('Add a global player to any team as organizer')
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Discord user to link')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('player_name')
                .setDescription('Player display name')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const target =
                message.mentions.users.first()
                || await getUserFromArgs(message, args);

            if (!target) {
                return message.reply('❌ Usage: `.admin-addplayer <team name> @user <player display name>`');
            }

            // Parse: strip mention/ID from args, remaining = team name + player name
            const cleanArgs = args
                .map(a => a.replace(/<@!?\d+>/, '').replace(/\d{17,20}/, '').trim())
                .filter(Boolean);

            // Last arg = player name, rest = team name
            const playerName = cleanArgs.pop() || target.username;
            const teamName = cleanArgs.join(' ').trim();

            if (!teamName) {
                return message.reply('❌ Usage: `.admin-addplayer <team name> @user <player display name>`');
            }

            return await runAdminAddPlayer({
                guild: message.guild,
                teamName,
                targetUser: target,
                playerName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[admin-addplayer] prefix error:', error);
            return message.reply('❌ Failed to add player.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runAdminAddPlayer({
                guild: interaction.guild,
                teamName: interaction.options.getString('team'),
                targetUser: interaction.options.getUser('user'),
                playerName: interaction.options.getString('player_name'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[admin-addplayer] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ Failed to add player.' });
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
 * Create a global Player linked to a team.
 * Auto-syncs to all active tournaments where the team is registered.
 */
async function runAdminAddPlayer({ guild, teamName, targetUser, playerName, reply }) {
    const userId = targetUser.id;
    // ── Find team (case-insensitive) ──
    const team = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (!team) {
        return reply({ content: `❌ Team not found: \`${teamName}\`` });
    }

    // ── Check if user is already a player ──
    const existing = await Player.findOne({
        guildId: guild.id,
        discordID: userId
    });

    if (existing) {
        return reply({
            content:
                `❌ This user is already linked as **${existing.name}**` +
                `${existing.teamNameSnapshot ? ` in **${existing.teamNameSnapshot}**` : ''}.`
        });
    }

    // ── Create the player ──
    const player = await Player.create({
        guildId: guild.id,
        name: playerName,
        discordID: userId,
        discordUsername: targetUser.username?.toLowerCase() || null,
        teamId: team._id,
        teamNameSnapshot: team.name,
        isCaptain: false,
        isViceCaptain: false
    });

    // ── Sync to active tournaments ──
    const sync = await syncPlayerToOpenTournaments(guild.id, player);

    // ── Response ──
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ GLOBAL PLAYER ADDED')
        .setDescription(
            `**${player.name}** has been added to **${team.name}**.\n` +
            `👤 Linked to: <@${userId}>`
        )
        .addFields({
            name: 'Tournament Sync',
            value: `Synced to active tournament entries: **${sync.syncedTournaments}**`,
            inline: false
        })
        .setFooter({
            text: 'Use /addplayertotournament if they need a specific tournament manually.'
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}
