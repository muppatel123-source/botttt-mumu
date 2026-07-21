/**
 * teamrolessync.js
 *
 * Sync all team Discord roles with database data.
 * Updates role colors and adds/removes members to match the DB.
 *
 * Usage:  .teamrolessync
 * Slash:  /teamrolessync
 * Aliases: syncroles, rolesync
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player
} = require('../../models/Tournament');

const { OWNER_IDS, isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'teamrolessync',
    description: 'Sync all team roles with database data.',
    usage: '.teamrolessync',
    aliases: ['syncroles', 'rolesync'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.ManageRoles],

    data: new SlashCommandBuilder()
        .setName('teamrolessync')
        .setDescription('Sync all team roles with database data'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            const allowed =
                OWNER_IDS.includes(message.author.id) ||
                await isOrganizer(message.guild.id, message.author.id);

            if (!allowed) {
                return message.reply('🚫 Only organizers can use this command.');
            }

            return await runSync({
                guild: message.guild,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[teamrolessync] prefix error:', error);
            return message.reply('❌ Failed to sync team roles.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            const allowed =
                OWNER_IDS.includes(interaction.user.id) ||
                await isOrganizer(interaction.guild.id, interaction.user.id);

            if (!allowed) {
                return interaction.reply({
                    content: '🚫 Only organizers can use this command.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: false });

            return await runSync({
                guild: interaction.guild,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[teamrolessync] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to sync team roles.');
            }

            return interaction.reply({
                content: '❌ Failed to sync team roles.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runSync({ guild, reply }) {

    const progressEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🔄 TEAM ROLE SYNC')
        .setDescription('Going through all registered teams and syncing roles...')
        .setTimestamp();

    const progressMessage = await reply({
        embeds: [progressEmbed]
    });

    const teams = await Team.find({
        guildId: guild.id
    }).lean();

    if (!teams.length) {
        return progressMessage.edit({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('❌ NO TEAMS FOUND')
                    .setDescription('No registered teams were found in this server.')
            ]
        });
    }

    const results = [];

    for (const team of teams) {

        try {

            const role = guild.roles.cache.find(r =>
                r.name.toLowerCase() === String(team.name || '').toLowerCase()
            );

            if (!role) {
                results.push(`⚠️ **${team.name}** → Team role does not exist`);
                continue;
            }

            let updated = false;

            /* ── Color sync ── */

            const teamColor = parseColor(team.color);

            if (teamColor && role.color !== teamColor) {
                await role.setColor(teamColor).catch(() => null);
                updated = true;
            }

            /* ── Player fetch ── */

            const players = await Player.find({
                guildId: guild.id,
                teamId: team._id
            }).select('discordID').lean();

            const databaseMemberIds = players
                .map(p => p.discordID)
                .filter(Boolean);

            const roleMemberIds = role.members.map(m => m.id);

            /* ── Add missing players ── */

            for (const userId of databaseMemberIds) {

                if (roleMemberIds.includes(userId)) continue;

                const member = await guild.members.fetch(userId).catch(() => null);

                if (!member) continue;

                await member.roles.add(role).catch(() => null);

                updated = true;
            }

            /* ── Remove extra players ── */

            for (const userId of roleMemberIds) {

                if (databaseMemberIds.includes(userId)) continue;

                const member = await guild.members.fetch(userId).catch(() => null);

                if (!member) continue;

                await member.roles.remove(role).catch(() => null);

                updated = true;
            }

            if (updated) {
                results.push(`✅ **${team.name}** → Updated`);
            } else {
                results.push(`☑️ **${team.name}** → Already synced`);
            }

            const liveEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔄 TEAM ROLE SYNC')
                .setDescription(results.join('\n').slice(0, 4000))
                .setFooter({
                    text: `${results.length}/${teams.length} teams checked`
                });

            await progressMessage.edit({
                embeds: [liveEmbed]
            });

        } catch (error) {

            console.error('[teamrolessync] role sync failed for %s:', team.name, error);

            results.push(`❌ **${team.name}** → Failed to sync`);
        }
    }

    const finalEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ TEAM ROLE SYNC COMPLETE')
        .setDescription(results.join('\n').slice(0, 4000))
        .setFooter({
            text: `${teams.length} teams checked`
        })
        .setTimestamp();

    return progressMessage.edit({
        embeds: [finalEmbed]
    });
}

/* ====================================================
   HELPERS
==================================================== */

function parseColor(color) {

    if (!color) return null;

    const cleaned = String(color)
        .trim()
        .replace('#', '');

    if (!/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
        return null;
    }

    return parseInt(cleaned, 16);
}
