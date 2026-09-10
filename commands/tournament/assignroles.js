/**
 * assignroles.js
 *
 * Bulk-assign tournament roles to ALL registered players in a tournament.
 * Captains (isCaptain) get the captain role, all others get the player role.
 * Reads role IDs from TournamentSettings (set via /settournament).
 *
 * Usage:  .assignroles [tournament_key]
 * Slash:  /assignroles tournament:<key>
 *
 * Aliases: syncroles, fixroles, giveallroles
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings,
    TournamentPlayer,
    Player
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { getTournamentByKey, getDefaultTournament } = require('../../utils/getTournament');

module.exports = {
    name: 'assignroles',
    description: 'Bulk-assign captain & player roles for a tournament.',
    usage: '.assignroles [tournament_key]',
    aliases: ['syncroles', 'fixroles', 'giveallroles'],
    hidden: false,
    cooldown: 10,

    data: new SlashCommandBuilder()
        .setName('assignroles')
        .setDescription('Bulk-assign captain & player roles for a tournament')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key (defaults to current tournament)')
                .setRequired(false)
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

            const key = args[0] || null;
            return await runAssignRoles({
                guild: message.guild,
                key,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[assignroles] prefix error:', error);
            return message.reply('❌ Failed to assign roles.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', flags: 64 });
            }

            const key = interaction.options.getString('tournament') || null;

            await interaction.deferReply({ flags: 64 });

            return await runAssignRoles({
                guild: interaction.guild,
                key,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[assignroles] slash error:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to assign roles.');
            }
            return interaction.reply({ content: '❌ Failed to assign roles.', flags: 64 });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runAssignRoles({ guild, key, reply }) {
    /* ── Resolve tournament ── */
    const tournament = key
        ? await getTournamentByKey(guild.id, key, { includeCompleted: true })
        : await getDefaultTournament(guild.id, { includeCompleted: true });

    if (!tournament) {
        return reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle('❌ Tournament Not Found')
                    .setDescription(key
                        ? `No tournament with key \`${key}\` found.`
                        : 'No default tournament set. Use `/settournament default=` first.')
            ]
        });
    }

    /* ── Check roles are configured ── */
    const captainRoleId = tournament.captainRoleId;
    const playerRoleId = tournament.tournamentPlayerRoleId;

    if (!captainRoleId && !playerRoleId) {
        return reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setTitle('❌ No Roles Configured')
                    .setDescription(
                        `Neither captain nor player role is set for **${tournament.tournamentName}**.\n` +
                        'Use `/settournament` to set `captainRole` and `playerRole` first.'
                    )
            ]
        });
    }

    /* ── Fetch all active tournament players ── */
    const tournamentPlayers = await TournamentPlayer.find({
        guildId: guild.id,
        tournamentId: tournament._id,
        isActive: true
    }).lean();

    if (!tournamentPlayers.length) {
        return reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('⚠️ No Players Found')
                    .setDescription(`No active players in **${tournament.tournamentName}**.`)
            ]
        });
    }

    /* ── Collect unique discordIDs, split into captains & players ── */
    const captainIds = new Set();
    const playerIds = new Set();

    // First pass: get Player records to resolve discordIDs
    const playerObjectIds = [...new Set(tournamentPlayers.map(tp => tp.playerId.toString()))];
    const players = await Player.find({
        _id: { $in: playerObjectIds },
        discordID: { $ne: null, $exists: true }
    }).lean();

    const playerDiscordMap = new Map(); // playerObjectId → discordID
    for (const p of players) {
        if (p.discordID) playerDiscordMap.set(p._id.toString(), p.discordID);
    }

    for (const tp of tournamentPlayers) {
        const discordID = playerDiscordMap.get(tp.playerId.toString());
        if (!discordID) continue;

        if (tp.isCaptain) {
            captainIds.add(discordID);
        } else {
            playerIds.add(discordID);
        }
    }

    // Captains who are also in the player set — they get captain role, remove from player set
    for (const id of captainIds) {
        playerIds.delete(id);
    }

    /* ── Resolve roles ── */
    const captainRole = captainRoleId ? guild.roles.cache.get(captainRoleId) : null;
    const playerRole = playerRoleId ? guild.roles.cache.get(playerRoleId) : null;

    const botMember = await guild.members.fetch(guild.client.user.id).catch(() => null);
    const canManageRoles = botMember?.permissions.has('ManageRoles') ?? false;

    /* ── Assign roles ── */
    const results = {
        captainAssigned: 0,
        captainAlready: 0,
        captainFailed: 0,
        playerAssigned: 0,
        playerAlready: 0,
        playerFailed: 0,
        skippedNoDiscord: 0
    };

    const failedCaptains = [];
    const failedPlayers = [];

    // Assign captain role
    if (captainRole && canManageRoles) {
        for (const discordID of captainIds) {
            const member = await guild.members.fetch(discordID).catch(() => null);
            if (!member) {
                results.captainFailed++;
                failedCaptains.push({ id: discordID, reason: 'not in server' });
                continue;
            }

            if (member.roles.cache.has(captainRole.id)) {
                results.captainAlready++;
                continue;
            }

            if (captainRole.managed || botMember.roles.highest.position <= captainRole.position) {
                results.captainFailed++;
                failedCaptains.push({ id: discordID, reason: 'role too high or managed' });
                continue;
            }

            try {
                await member.roles.add(captainRole);
                results.captainAssigned++;
            } catch {
                results.captainFailed++;
                failedCaptains.push({ id: discordID, reason: 'permission error' });
            }
        }
    } else if (captainRole && !canManageRoles) {
        results.captainFailed = captainIds.size;
        failedCaptains.push({ id: 'all', reason: 'bot lacks Manage Roles permission' });
    }

    // Assign player role
    if (playerRole && canManageRoles) {
        for (const discordID of playerIds) {
            const member = await guild.members.fetch(discordID).catch(() => null);
            if (!member) {
                results.playerFailed++;
                failedPlayers.push({ id: discordID, reason: 'not in server' });
                continue;
            }

            if (member.roles.cache.has(playerRole.id)) {
                results.playerAlready++;
                continue;
            }

            if (playerRole.managed || botMember.roles.highest.position <= playerRole.position) {
                results.playerFailed++;
                failedPlayers.push({ id: discordID, reason: 'role too high or managed' });
                continue;
            }

            try {
                await member.roles.add(playerRole);
                results.playerAssigned++;
            } catch {
                results.playerFailed++;
                failedPlayers.push({ id: discordID, reason: 'permission error' });
            }
        }
    } else if (playerRole && !canManageRoles) {
        results.playerFailed = playerIds.size;
        failedPlayers.push({ id: 'all', reason: 'bot lacks Manage Roles permission' });
    }

    // Count players with no discordID
    const noDiscord = tournamentPlayers.filter(tp => !playerDiscordMap.has(tp.playerId.toString())).length;
    results.skippedNoDiscord = noDiscord;

    /* ── Build result embed ── */
    const totalProcessed = results.captainAssigned + results.captainAlready +
                          results.playerAssigned + results.playerAlready;
    const totalFailed = results.captainFailed + results.playerFailed;

    const fields = [];

    if (captainRole) {
        fields.push({
            name: `${captainRole.name} (Captain Role)`,
            value:
                `✅ Assigned: **${results.captainAssigned}**\n` +
                `☑️ Already had: **${results.captainAlready}**\n` +
                `❌ Failed: **${results.captainFailed}**`,
            inline: true
        });
    } else if (captainRoleId) {
        fields.push({
            name: 'Captain Role',
            value: '⚠️ Role ID set but role not found in server',
            inline: true
        });
    }

    if (playerRole) {
        fields.push({
            name: `${playerRole.name} (Player Role)`,
            value:
                `✅ Assigned: **${results.playerAssigned}**\n` +
                `☑️ Already had: **${results.playerAlready}**\n` +
                `❌ Failed: **${results.playerFailed}**`,
            inline: true
        });
    } else if (playerRoleId) {
        fields.push({
            name: 'Player Role',
            value: '⚠️ Role ID set but role not found in server',
            inline: true
        });
    }

    if (results.skippedNoDiscord > 0) {
        fields.push({
            name: '⏭️ Skipped (no Discord ID)',
            value: `${results.skippedNoDiscord} player(s) have no Discord ID linked`,
            inline: false
        });
    }

    if (failedCaptains.length > 0 && failedCaptains[0].id !== 'all') {
        const lines = failedCaptains.slice(0, 10).map(f => `<@${f.id}> — ${f.reason}`);
        fields.push({
            name: 'Captain Failures',
            value: lines.join('\n') + (failedCaptains.length > 10 ? `\n... +${failedCaptains.length - 10} more` : ''),
            inline: false
        });
    }

    if (failedPlayers.length > 0 && failedPlayers[0].id !== 'all') {
        const lines = failedPlayers.slice(0, 10).map(f => `<@${f.id}> — ${f.reason}`);
        fields.push({
            name: 'Player Failures',
            value: lines.join('\n') + (failedPlayers.length > 10 ? `\n... +${failedPlayers.length - 10} more` : ''),
            inline: false
        });
    }

    const embed = new EmbedBuilder()
        .setColor(totalFailed > 0 ? 0xF1C40F : 0x2ECC71)
        .setTitle(`🎭 Role Assignment — ${tournament.tournamentName}`)
        .setDescription(
            `Processed **${tournamentPlayers.length}** tournament players.\n` +
            `Captains: **${captainIds.size}** | Players: **${playerIds.size}**`
        )
        .addFields(fields)
        .setTimestamp();

    if (!canManageRoles) {
        embed.setFooter({ text: '⚠️ Bot lacks Manage Roles permission — no roles were actually assigned' });
    }

    return reply({ embeds: [embed] });
}
