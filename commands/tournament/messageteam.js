/**
 * messageteam.js
 *
 * Send a DM to every player on your team (captain/VC only).
 * Skips the sender, tracks delivery success/failure.
 *
 * Usage:  .mt <message>
 * Slash:  /messageteam message:<message>
 *
 * Aliases: mt
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Team, Player } = require('../../models/Tournament');

module.exports = {
    name: 'messageteam',
    aliases: ['mt'],
    description: 'Send a DM to every player in your team.',
    hidden: false,
    cooldown: 10,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('messageteam')
        .setDescription('Message your entire team')
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('Message to send')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const content = args.join(' ').trim();

            if (!content) {
                return message.reply('❓ Usage: `.mt Your message here`');
            }

            return await runMessageTeam({
                guild: message.guild,
                captainId: message.author.id,
                content,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[messageteam] prefix error:', error);
            return message.reply('❌ Failed to send team message.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            const content = interaction.options.getString('message');

            await interaction.deferReply({ ephemeral: true });

            return await runMessageTeam({
                guild: interaction.guild,
                captainId: interaction.user.id,
                content,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[messageteam] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to send team message.');
            }

            return interaction.reply({ content: '❌ Failed to send team message.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * DM every player on the actor's team.
 * 1. Find team via captain/VC lookup
 * 2. Load all players
 * 3. Send DM embed to each (skip sender)
 */
async function runMessageTeam({ guild, captainId, content, reply }) {
    /* ── Find team where actor is captain or VC ── */
    let team = await Team.findOne({
        guildId: guild.id,
        captainID: captainId
    });

    let isViceCaptain = false;

    if (!team) {
        team = await Team.findOne({
            guildId: guild.id,
            viceCaptainID: captainId
        });

        if (team) isViceCaptain = true;
    }

    if (!team) {
        return reply({ content: '❌ You are not registered as a team captain or vice captain.' });
    }

    /* ── Load all players on the team ── */
    const players = await Player.find({
        guildId: guild.id,
        teamId: team._id
    });

    if (!players.length) {
        return reply({ content: '❌ No players found in your team.' });
    }

    /* ── Send DM to each player (skip sender) ── */
    let success = 0;
    let failed = 0;

    const senderRole = isViceCaptain ? 'vice captain' : 'captain';

    const dmEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle(`📢 Team Message — ${team.name}`)
        .setDescription(content)
        .setFooter({ text: `Sent by your ${senderRole}` })
        .setTimestamp();

    for (const player of players) {
        try {
            if (!player.discordID || player.discordID === captainId) continue;

            const user = await guild.client.users.fetch(player.discordID);
            if (!user) { failed++; continue; }

            await user.send({ embeds: [dmEmbed] });
            success++;
        } catch {
            failed++;
        }
    }

    /* ── Response ── */
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Team Message Sent')
        .setDescription(
            `Team: **${team.name}**\n\n` +
            `Delivered: **${success}**\n` +
            `Failed: **${failed}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
