/**
 * pingteam.js
 *
 * Ping your team's Discord role. Captain/VC only.
 * Uses a manual 10s cooldown per user per guild.
 * Sends ONLY the role ping — no confirmation message.
 *
 * Usage:  .pingteam
 * Slash:  /pingteam
 *
 * Aliases: pt
 */

const { SlashCommandBuilder } = require('discord.js');
const { Team } = require('../../models/Tournament');

const COOLDOWN = 10 * 1000;
const cooldowns = new Map();

module.exports = {
    name: 'pingteam',
    description: 'Ping your team captain-only.',
    usage: '.pingteam',
    aliases: ['pt'],
    hidden: false,
    cooldown: 10,

    data: new SlashCommandBuilder()
        .setName('pingteam')
        .setDescription('Ping your team captain-only'),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            return await runPing({
                guild: message.guild,
                user: message.author,
                channel: message.channel,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[pingteam] prefix error:', error);
            return message.reply('❌ Failed to ping team.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            return await runPing({
                guild: interaction.guild,
                user: interaction.user,
                channel: interaction.channel,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[pingteam] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to ping team.');
            }

            return interaction.reply({ content: '❌ Failed to ping team.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/** Ping the team's Discord role. Only captain/VC can use this. */
async function runPing({ guild, user, channel, reply }) {
    /* ── Cooldown check ── */
    const now = Date.now();
    const cooldownKey = `${guild.id}:${user.id}`;

    if (cooldowns.has(cooldownKey)) {
        const expires = cooldowns.get(cooldownKey);

        if (now < expires) {
            const remaining = Math.ceil((expires - now) / 1000);
            return reply({ content: `⏳ You can ping again in **${remaining}s**.` });
        }
    }

    /* ── Find team where user is captain or VC ── */
    let team = await Team.findOne({
        guildId: guild.id,
        captainID: user.id
    });

    if (!team) {
        team = await Team.findOne({
            guildId: guild.id,
            viceCaptainID: user.id
        });
    }

    if (!team) {
        return reply({ content: '🚫 Only team captains or vice captains can use this command.' });
    }

    /* ── Find matching Discord role ── */
    const role = guild.roles.cache.find(
        r => r.name.toLowerCase() === team.name.toLowerCase()
    );

    if (!role) {
        return reply({ content: `❌ Team role for **${team.name}** not found.` });
    }

    /* ── Ping and set cooldown ── */
    await channel.send({ content: `<@&${role.id}>` });

    cooldowns.set(cooldownKey, now + COOLDOWN);
}
