/**
 * myteam.js
 *
 * View your team details, squad, stats, and trophies.
 * Supports interactive switching between Overview and Trophies views.
 *
 * Usage:  .myteam [team name]
 * Slash:  /myteam [team]
 *
 * Aliases: teamview, squad, club
 */

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const {
    Team,
    Player,
    TournamentTeam,
    UserProfile
} = require('../../models/Tournament');

const { escapeRegex } = require('../../utils/stringHelpers');
const { parseColor } = require('../../utils/displayHelpers');

module.exports = {
    name: 'myteam',
    description: 'View your team details, stats and trophies.',
    usage: '.myteam [team name]',
    aliases: ['teamview', 'squad', 'club'],
    hidden: false,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('myteam')
        .setDescription('View your team details and squad')
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Optional team name')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            return await runMyTeam({
                guild: message.guild,
                viewerId: message.author.id,
                requestedTeamName: args.length ? args.join(' ').trim() : null,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[myteam] prefix error:', error);
            return message.reply('❌ Failed to load team details.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            return await runMyTeam({
                guild: interaction.guild,
                viewerId: interaction.user.id,
                requestedTeamName: interaction.options.getString('team'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[myteam] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to load team details.');
            }

            return interaction.reply({ content: '❌ Failed to load team details.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runMyTeam({ guild, viewerId, requestedTeamName, reply }) {
    const team = await resolveTeam({ guild, userId: viewerId, requestedTeamName });

    if (!team) {
        return reply({
            content: requestedTeamName
                ? `❌ Team not found: \`${requestedTeamName}\``
                : '❌ You are not linked to a team yet. Use `.myteam <Team Name>`.'
        });
    }

    let view = 'overview';

    const payload = await buildPayload({ guild, team, view });

    const msg = await reply(payload);

    if (!msg?.createMessageComponentCollector) return;

    const collector = msg.createMessageComponentCollector({ time: 600000 });

    collector.on('collect', async interaction => {
        try {
            if (interaction.user.id !== viewerId) {
                return interaction.reply({ content: 'Not your menu.', ephemeral: true });
            }

            if (interaction.isButton()) {
                if (interaction.customId === 'myteam_overview') view = 'overview';
                if (interaction.customId === 'myteam_trophies') view = 'trophies';
            }

            const updatedPayload = await buildPayload({ guild, team, view });
            await interaction.update(updatedPayload);
        } catch (error) {
            console.error('[myteam] collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Failed to update team view.', ephemeral: true }).catch(() => null);
            }
        }
    });

    collector.on('end', async () => {
        await msg.edit({ components: [] }).catch(() => null);
    });
}

/* ====================================================
   TEAM RESOLUTION
==================================================== */

async function resolveTeam({ guild, userId, requestedTeamName }) {
    if (requestedTeamName) {
        return Team.findOne({
            guildId: guild.id,
            name: { $regex: new RegExp(`^${escapeRegex(requestedTeamName)}$`, 'i') }
        });
    }

    const player = await Player.findOne({
        guildId: guild.id,
        discordID: userId
    }).populate('teamId');

    if (player?.teamId) return player.teamId;

    if (player?.teamNameSnapshot) {
        return Team.findOne({
            guildId: guild.id,
            name: { $regex: new RegExp(`^${escapeRegex(player.teamNameSnapshot)}$`, 'i') }
        });
    }

    return null;
}

/* ====================================================
   EMBED BUILDERS
==================================================== */

async function buildPayload({ guild, team, view }) {
    const embed = view === 'trophies'
        ? await buildTrophiesEmbed({ guild, team })
        : await buildOverviewEmbed({ guild, team });

    return {
        embeds: [embed],
        components: [buildButtons(view)]
    };
}

async function buildOverviewEmbed({ guild, team }) {
    const players = await Player.find({
        guildId: guild.id,
        teamId: team._id
    }).sort({ isCaptain: -1, name: 1 });

    const tournamentEntries = await TournamentTeam.find({
        guildId: guild.id,
        teamId: team._id,
        isActive: true
    }).populate('tournamentId').lean();

    const statsLines = tournamentEntries.length
        ? tournamentEntries.map(entry => {
            const tournament = entry.tournamentId;
            const stats = entry.stats || {};
            const gd = (stats.gf || 0) - (stats.ga || 0);
            const emoji = tournament?.emoji || '🏆';

            return (
                `${emoji} **${tournament?.name || entry.teamNameSnapshot || 'Tournament'}**\n` +
                `P: **${stats.played || 0}** | W: **${stats.wins || 0}** | D: **${stats.draws || 0}** | L: **${stats.losses || 0}** | ` +
                `GD: **${gd >= 0 ? '+' : ''}${gd}** | Pts: **${stats.points || 0}**`
            );
        }).join('\n\n')
        : 'This team is not active in any tournament yet.';

    const embed = new EmbedBuilder()
        .setColor(parseColor(team.color))
        .setTitle(`🏟️ ${team.name.toUpperCase()}`)
        .addFields(
            {
                name: 'Team Info',
                value:
                    `👑 Captain: ${team.captainID ? `<@${team.captainID}>` : 'Not Assigned'}\n` +
                    `🏟️ Stadium: ${team.stadium || 'Not Set'}`,
                inline: false
            },
            {
                name: 'Tournament Stats',
                value: statsLines,
                inline: false
            },
            {
                name: 'Squad',
                value: players.length
                    ? players.map((player, index) => {
                        const crown = player.isCaptain ? ' 👑' : '';
                        const linked = player.discordID ? ` (<@${player.discordID}>)` : '';
                        return `${index + 1}. **${player.name}**${crown}${linked}`;
                    }).join('\n')
                    : 'No players registered yet.',
                inline: false
            }
        )
        .setTimestamp();

    if (team.logoURL) {
        embed.setImage(team.logoURL);
    } else if (guild.iconURL()) {
        embed.setThumbnail(guild.iconURL());
    }

    return embed;
}

async function buildTrophiesEmbed({ guild, team }) {
    const trophies = await collectTeamTrophies({ guildId: guild.id, team });

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`🏆 ${team.name.toUpperCase()} TROPHIES`)
        .setDescription(
            trophies.length
                ? trophies.map(formatTrophyLine).join('\n')
                : 'No trophies won yet.'
        )
        .setTimestamp();

    if (team.logoURL) {
        embed.setThumbnail(team.logoURL);
    } else if (guild.iconURL()) {
        embed.setThumbnail(guild.iconURL());
    }

    return embed;
}

/* ====================================================
   TROPHY COLLECTION
==================================================== */

async function collectTeamTrophies({ guildId, team }) {
    const trophyMap = new Map();

    const teamDoc = await Team.findById(team._id).lean().catch(() => null);
    for (const trophy of teamDoc?.trophies || []) {
        addTrophyToMap(trophyMap, trophy);
    }

    const tournamentTeamDocs = await TournamentTeam.find({
        guildId,
        $or: [
            { teamId: team._id },
            { teamNameSnapshot: team.name }
        ]
    }).lean();

    for (const entry of tournamentTeamDocs) {
        for (const trophy of entry.trophies || []) {
            addTrophyToMap(trophyMap, trophy);
        }
    }

    const profiles = await UserProfile.find({
        guildId,
        'trophies.teamName': team.name
    }).lean();

    for (const profile of profiles) {
        for (const trophy of profile.trophies || []) {
            if (trophy.teamName !== team.name) continue;
            addTrophyToMap(trophyMap, trophy);
        }
    }

    return Array.from(trophyMap.values())
        .sort((a, b) => new Date(b.awardedAt || 0) - new Date(a.awardedAt || 0));
}

function addTrophyToMap(map, trophy) {
    const clean = normalizeTrophy(trophy);
    if (!clean) return;

    const key = `${clean.tournamentKey}:${clean.label}`;
    if (!map.has(key)) map.set(key, clean);
}

function normalizeTrophy(trophy) {
    if (!trophy) return null;

    const tournamentName = trophy.tournamentName || trophy.tournamentKey || 'Tournament';
    const tournamentKey = trophy.tournamentKey || tournamentName.toLowerCase().replace(/\s+/g, '-');

    let label = '';

    if (trophy.type === 'champion') label = 'Winner';
    else if (trophy.type === 'runner_up') label = 'Runner Up';
    else if (String(trophy.name || '').toLowerCase() === 'winner') label = 'Winner';
    else if (String(trophy.name || '').toLowerCase() === 'runner up') label = 'Runner Up';
    else if (String(trophy.label || '').toLowerCase() === 'winner') label = 'Winner';
    else if (String(trophy.label || '').toLowerCase() === 'runner up') label = 'Runner Up';
    else if (String(trophy.title || '').toLowerCase().includes('winner')) label = 'Winner';
    else if (String(trophy.title || '').toLowerCase().includes('runner up')) label = 'Runner Up';

    if (!label) return null;

    const emoji = trophy.emoji || (label === 'Winner' ? '🏆' : '🥈');

    return {
        tournamentKey,
        tournamentName,
        label,
        emoji,
        awardedAt: trophy.awardedAt || null
    };
}

function formatTrophyLine(trophy) {
    return `${trophy.emoji} **${trophy.tournamentName} ${trophy.label}**`;
}

/* ====================================================
   UI COMPONENTS
==================================================== */

function buildButtons(view) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('myteam_overview')
            .setLabel('Team Overview')
            .setStyle(view === 'overview' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('myteam_trophies')
            .setLabel('Trophies')
            .setStyle(view === 'trophies' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
}
