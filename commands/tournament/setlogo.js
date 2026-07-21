/**
 * setlogo.js
 *
 * Set your team logo, or set any team logo as organizer.
 * Captain/VC can set their own team's logo. Organizers can set any team.
 * Accepts image URLs or Discord attachments.
 *
 * Usage:  .setlogo <image link>  (or attach image)
 *         .setlogo <team name> <image link>  (organizer only)
 * Slash:  /setlogo [image_url] [team:<name>]
 *
 * Aliases: logo
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { Team } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');
const { escapeRegex } = require('../../utils/stringHelpers');

module.exports = {
    name: 'setlogo',
    description: 'Set your team logo, or set any team logo as organizer.',
    usage: '.setlogo [team name] <image link> OR upload attachment',
    aliases: ['logo'],
    hidden: false,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('setlogo')
        .setDescription('Set team logo')
        .addStringOption(opt =>
            opt.setName('image_url')
                .setDescription('Image link for logo')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Organizer only: team name')
                .setRequired(false)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const organizer = await isOrganizer(message.guild.id, message.author.id);

            let logoURL = null;
            let teamName = null;

            if (message.attachments.first()) {
                logoURL = message.attachments.first().url;

                if (organizer && args.length) {
                    teamName = args.join(' ').trim();
                }
            } else {
                const urlIndex = args.findIndex(arg => /^https?:\/\//i.test(arg));

                if (urlIndex !== -1) {
                    logoURL = args[urlIndex];

                    if (organizer && urlIndex > 0) {
                        teamName = args.slice(0, urlIndex).join(' ').trim();
                    }
                }
            }

            return await runSetLogo({
                guild: message.guild,
                userId: message.author.id,
                organizer,
                teamName,
                logoURL,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setlogo] prefix error:', error);
            return message.reply('❌ Failed to update logo.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const organizer = await isOrganizer(interaction.guild.id, interaction.user.id);

            return await runSetLogo({
                guild: interaction.guild,
                userId: interaction.user.id,
                organizer,
                teamName: interaction.options.getString('team'),
                logoURL: interaction.options.getString('image_url'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setlogo] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to update logo.');
            }

            return interaction.reply({
                content: '❌ Failed to update logo.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Set a team's logo.
 * Captain/VC path: resolve team from user's membership.
 * Organizer path: resolve team by name argument.
 */
async function runSetLogo({ guild, userId, organizer, teamName, logoURL, reply }) {
    const team = await resolveTeam({ guild, userId, organizer, teamName });

    if (!team) {
        return reply({
            content: organizer && teamName
                ? `❌ Team not found: \`${teamName}\``
                : '🚫 Only **Team Captains / Vice Captains** can set their own logo. Organizers can use `.setlogo <team name> <image link>`.'
        });
    }

    if (!logoURL) {
        return reply({
            content:
                '❓ Usage:\n' +
                'Captain: `.setlogo <image_link>` or attach image with `.setlogo`\n' +
                'Organizer: `.setlogo <team name> <image_link>` or attach image with `.setlogo <team name>`'
        });
    }

    if (!isValidImageUrl(logoURL)) {
        return reply({
            content:
                '❌ Invalid image link.\n' +
                'Use a direct image URL ending with `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif`.'
        });
    }

    team.logoURL = logoURL;
    await team.save();

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🛡️ TEAM LOGO UPDATED')
        .setDescription(`Logo updated for **${team.name}**.`)
        .setImage(logoURL)
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   HELPERS
==================================================== */

/**
 * Resolve which team to operate on.
 * Organizer + teamName → find by name.
 * Otherwise → find by captain/VC membership.
 */
async function resolveTeam({ guild, userId, organizer, teamName }) {
    if (organizer && teamName) {
        return Team.findOne({
            guildId: guild.id,
            name: {
                $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
            }
        });
    }

    // Captain or vice captain
    let team = await Team.findOne({
        guildId: guild.id,
        captainID: userId
    });

    if (!team) {
        team = await Team.findOne({
            guildId: guild.id,
            viceCaptainID: userId
        });
    }

    return team;
}

/** Check if a URL points to a valid image format. */
function isValidImageUrl(url) {
    const value = String(url || '').trim();

    if (!/^https?:\/\//i.test(value)) return false;

    return /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(value);
}
