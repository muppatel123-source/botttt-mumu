/**
 * setcolor.js
 *
 * Set your team color, or set any team color as organizer.
 * Captain/VC can set their own team's color. Organizers can set any team.
 *
 * Usage:  .setcolor <color name OR hex>
 *         .setcolor <team name> <color>  (organizer only)
 * Slash:  /setcolor color:<color> [team:<name>]
 *
 * Aliases: teamcolor
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { Team } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');
const { escapeRegex } = require('../../utils/stringHelpers');

module.exports = {
    name: 'setcolor',
    description: 'Set your team color, or set any team color as organizer.',
    usage: '.setcolor [team name] <color name OR hex>',
    aliases: ['teamcolor'],
    hidden: false,
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('setcolor')
        .setDescription('Set team color')
        .addStringOption(opt =>
            opt.setName('color')
                .setDescription('Color name or hex code')
                .setRequired(true)
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

            if (!args.length) {
                return message.reply(
                    '❓ Usage:\n' +
                    'Captain: `.setcolor red`\n' +
                    'Organizer: `.setcolor Falcons red`'
                );
            }

            const colorInput = args[args.length - 1];
            const teamName = organizer && args.length > 1
                ? args.slice(0, -1).join(' ').trim()
                : null;

            return await runSetColor({
                guild: message.guild,
                userId: message.author.id,
                organizer,
                teamName,
                colorInput,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setcolor] prefix error:', error);
            return message.reply('❌ Failed to update team color.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const organizer = await isOrganizer(interaction.guild.id, interaction.user.id);

            return await runSetColor({
                guild: interaction.guild,
                userId: interaction.user.id,
                organizer,
                teamName: interaction.options.getString('team'),
                colorInput: interaction.options.getString('color'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setcolor] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to update team color.');
            }

            return interaction.reply({
                content: '❌ Failed to update team color.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   COLOR MAP
==================================================== */

/** Named color to hex map. */
const COLOR_MAP = {
    red: '#FF0000',
    blue: '#3498DB',
    green: '#2ECC71',
    yellow: '#F1C40F',
    orange: '#E67E22',
    purple: '#9B59B6',
    pink: '#E91E63',
    black: '#111111',
    white: '#FFFFFF',
    grey: '#808080',
    gray: '#808080',
    cyan: '#00FFFF',
    teal: '#1ABC9C',
    gold: '#FFD700',
    silver: '#C0C0C0',
    maroon: '#800000',
    navy: '#000080'
};

/**
 * Parse a color input (name or hex) into a hex string.
 * Returns { ok: true, hex } or { ok: false }.
 */
function parseColorInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return { ok: false };

    const lower = raw.toLowerCase();
    if (COLOR_MAP[lower]) return { ok: true, hex: COLOR_MAP[lower] };

    const cleaned = raw.replace('#', '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(cleaned)) return { ok: true, hex: `#${cleaned}` };

    return { ok: false };
}

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Set a team's color.
 * Captain/VC path: resolve team from user's membership.
 * Organizer path: resolve team by name argument.
 */
async function runSetColor({ guild, userId, organizer, teamName, colorInput, reply }) {
    const team = await resolveTeam({ guild, userId, organizer, teamName });

    if (!team) {
        return reply({
            content: organizer && teamName
                ? `❌ Team not found: \`${teamName}\``
                : '🚫 Only **Team Captains / Vice Captains** can set their own color. Organizers can use `.setcolor <team name> <color>`.'
        });
    }

    const parsed = parseColorInput(colorInput);

    if (!parsed.ok) {
        return reply({
            content:
                '❌ Invalid color.\n' +
                'Use a hex code like `#FF0000` or a color name like `red`, `blue`, `gold`, `purple`.'
        });
    }

    team.color = parsed.hex;
    await team.save();

    const embed = new EmbedBuilder()
        .setColor(parseInt(parsed.hex.replace('#', ''), 16))
        .setTitle('🎨 TEAM COLOR UPDATED')
        .setDescription(
            `**${team.name}** color updated.\n\n` +
            `Color: \`${parsed.hex}\``
        )
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
