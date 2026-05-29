const {
    SlashCommandBuilder
} = require('discord.js');

const { Team, Player } = require('../../models/Tournament');

const COOLDOWN = 10 * 1000;
const cooldowns = new Map();

module.exports = {
    name: 'pingteam',
    description: 'Ping your team captain-only.',
    usage: '.pingteam',
    aliases: ['pt'],

    data: new SlashCommandBuilder()
        .setName('pingteam')
        .setDescription('Ping your team captain-only'),

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
            console.error('pingteam prefix error:', error);
            return message.reply('❌ Failed to ping team.');
        }
    },

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
            console.error('pingteam slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ Failed to ping team.' });
            }

            return interaction.reply({
                content: '❌ Failed to ping team.',
                ephemeral: true
            });
        }
    }
};

async function runPing({
    guild,
    user,
    channel,
    reply
}) {
    const now = Date.now();

    const cooldownKey = `${guild.id}:${user.id}`;

    if (cooldowns.has(cooldownKey)) {
        const expires = cooldowns.get(cooldownKey);

        if (now < expires) {
            const remaining = Math.ceil((expires - now) / 1000);

            return reply({
                content: `⏳ You can ping again in **${remaining}s**.`
            });
        }
    }

    const team = await Team.findOne({
        guildId: guild.id,
        captainID: user.id
    });

    if (!team) {
        return reply({
            content: '🚫 Only team captains can use this command.'
        });
    }

    const players = await Player.find({
        guildId: guild.id,
        teamId: team._id
    });

    if (!players.length) {
        return reply({
            content: '❌ No players found in your team.'
        });
    }

    const mentions = players
        .filter(player => player.discordID)
        .map(player => `<@${player.discordID}>`);

    if (!mentions.length) {
        return reply({
            content: '❌ No linked Discord users found in your team.'
        });
    }

    await channel.send({
        content:
            `📢 **${team.name}** team ping by <@${user.id}>\n` +
            mentions.join(' ')
    });

    cooldowns.set(cooldownKey, now + COOLDOWN);

    return reply({
        content: `✅ Pinged **${team.name}**.`
    });
}