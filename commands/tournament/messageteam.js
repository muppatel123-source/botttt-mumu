const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player
} = require('../../models/Tournament');

module.exports = {
    name: 'messageteam',
    aliases: ['mt'],
    description: 'Send a DM to every player in your team.',

    cooldown: 10,

    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('messageteam')
        .setDescription('Message your entire team')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('Message to send')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const content = args.join(' ').trim();

            if (!content) {
                return message.reply(
                    '❓ Usage: `.mt Your message here`'
                );
            }

            return sendTeamMessage({
                guild: message.guild,
                captainId: message.author.id,
                content,
                reply: payload => message.reply(payload)
            });

        } catch (err) {
            console.error(err);

            return message.reply(
                '❌ Failed to send team message.'
            );
        }
    },

    async slashExecute(interaction) {
        try {
            const content =
                interaction.options.getString('message');

            await interaction.deferReply({
                ephemeral: true
            });

            return sendTeamMessage({
                guild: interaction.guild,
                captainId: interaction.user.id,
                content,
                reply: payload =>
                    interaction.editReply(payload)
            });

        } catch (err) {
            console.error(err);

            if (
                interaction.deferred ||
                interaction.replied
            ) {
                return interaction.editReply(
                    '❌ Failed to send team message.'
                );
            }

            return interaction.reply({
                content:
                    '❌ Failed to send team message.',
                ephemeral: true
            });
        }
    }
};

async function sendTeamMessage({
    guild,
    captainId,
    content,
    reply
}) {
    const team = await Team.findOne({
        guildId: guild.id,
        captainID: captainId
    });

    if (!team) {
        return reply({
            content:
                '❌ You are not registered as a team captain.'
        });
    }

    const players = await Player.find({
        guildId: guild.id,
        teamId: team._id
    });

    if (!players.length) {
        return reply({
            content:
                '❌ No players found in your team.'
        });
    }

    let success = 0;
    let failed = 0;

    const dmEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle(`📢 Team Message — ${team.name}`)
        .setDescription(content)
        .setFooter({
            text: `Sent by your captain`
        })
        .setTimestamp();

    for (const player of players) {
        try {
            if (!player.discordID) {
                failed++;
                continue;
            }

          if (player.discordID === captainId) {
    continue;
}

            const user =
                await guild.client.users.fetch(
                    player.discordID
                );

            if (!user) {
                failed++;
                continue;
            }

            await user.send({
                embeds: [dmEmbed]
            });

            success++;

        } catch {
            failed++;
        }
    }

    return reply({
        embeds: [
            new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✅ Team Message Sent')
                .setDescription(
                    `Team: **${team.name}**\n\n` +
                    `Delivered: **${success}**\n` +
                    `Failed: **${failed}**`
                )
                .setTimestamp()
        ]
    });
}
