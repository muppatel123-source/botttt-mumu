const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    ServerConfig
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

const VALID_AWARDS = [
    'ballon_dor',
    'golden_boot',
    'golden_glove',
    'playmaker'
];

module.exports = {
    name: 'setserveremoji',
    description: 'Set server-wide award emoji.',
    usage: '.setserveremoji award <type> <emoji>',
    aliases: ['ssemoji'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setserveremoji')
        .setDescription('Set server emoji')
        .addStringOption(opt =>
            opt.setName('category')
                .setDescription('Only: award')
                .setRequired(true)
                .addChoices({
                    name: 'Award',
                    value: 'award'
                })
        )
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Award type')
                .setRequired(true)
                .addChoices(
                    {
                        name: 'Ballon dOr',
                        value: 'ballon_dor'
                    },
                    {
                        name: 'Golden Boot',
                        value: 'golden_boot'
                    },
                    {
                        name: 'Golden Glove',
                        value: 'golden_glove'
                    },
                    {
                        name: 'Playmaker',
                        value: 'playmaker'
                    }
                )
        )
        .addStringOption(opt =>
            opt.setName('emoji')
                .setDescription('Emoji code')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (args.length < 3) {
                return message.reply(
                    '❓ Usage: `.setserveremoji award <type> <emoji>`'
                );
            }

            const category = args[0].toLowerCase();
            const type = args[1].toLowerCase();
            const emoji = args.slice(2).join(' ').trim();

            return await runCommand({
                guildId: message.guild.id,
                category,
                type,
                emoji,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('setserveremoji prefix error:', error);
            return message.reply('❌ Failed to set emoji.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 Unauthorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runCommand({
                guildId: interaction.guild.id,
                category: interaction.options.getString('category'),
                type: interaction.options.getString('type'),
                emoji: interaction.options.getString('emoji').trim(),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('setserveremoji slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to set emoji.');
            }

            return interaction.reply({
                content: '❌ Failed to set emoji.',
                ephemeral: true
            });
        }
    }
};

async function runCommand({
    guildId,
    category,
    type,
    emoji,
    reply
}) {
    if (category !== 'award') {
        return reply({
            content: '❌ Only `award` category is supported.'
        });
    }

    if (!VALID_AWARDS.includes(type)) {
        return reply({
            content: '❌ Invalid award type.'
        });
    }

    const config = await ServerConfig.findOneAndUpdate(
        {
            guildId
        },
        {
            $set: {
                [`emojis.awards.${type}`]: emoji
            }
        },
        {
            upsert: true,
            new: true
        }
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ AWARD EMOJI UPDATED')
        .setDescription(
            `Award Type: **${type}**\n` +
            `Emoji: ${emoji}`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}