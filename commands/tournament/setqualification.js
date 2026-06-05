const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings
} = require('../../models/Tournament');

const {
    isOrganizer
} = require('../../utils/isOrganizer');

module.exports = {
    name: 'setqualification',
    description: 'Set qualification spots per group.',
    usage: '.setqualification <tournamentKey> <spots>',
    aliases: ['setq', 'setqualify'],
    hidden: true,

    data: new SlashCommandBuilder()
        .setName('setqualification')
        .setDescription('Set qualification spots per group')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('spots')
                .setDescription('Qualification spots')
                .setRequired(true)
        ),

    async execute(message, args) {
        if (!message.guild) return;

        if (!(await isOrganizer(message.guild.id, message.author.id))) {
            return message.reply('🚫 Unauthorized.');
        }

        const tournamentKey = args[0]?.toLowerCase();
        const spots = Number(args[1]);

        if (!tournamentKey || !spots || spots < 1) {
            return message.reply(
                '❓ Usage: `.setqualification <tournamentKey> <spots>`'
            );
        }

        return updateQualification({
            guildId: message.guild.id,
            tournamentKey,
            spots,
            reply: payload => message.reply(payload)
        });
    },

    async slashExecute(interaction) {
        if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
            return interaction.reply({
                content: '🚫 Unauthorized.',
                ephemeral: true
            });
        }

        const tournamentKey =
            interaction.options.getString('tournament').toLowerCase();

        const spots =
            interaction.options.getInteger('spots');

        return updateQualification({
            guildId: interaction.guild.id,
            tournamentKey,
            spots,
            reply: payload => interaction.reply(payload)
        });
    }
};

async function updateQualification({
    guildId,
    tournamentKey,
    spots,
    reply
}) {
    const tournament =
        await TournamentSettings.findOneAndUpdate(
            {
                guildId,
                tournamentKey
            },
            {
                $set: {
                    qualificationSpotsPerGroup: spots
                }
            },
            {
                new: true
            }
        );

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ QUALIFICATION UPDATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n\n` +
            `Teams qualifying from each group: **${spots}**`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}
