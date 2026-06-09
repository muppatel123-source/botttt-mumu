const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings
} = require('../../models/Tournament');

const {
    isOrganizer
} = require('../../utils/isOrganizer');

module.exports = {
    name: 'setuclqualification',
    description: 'Set league UCL qualification spots.',
    usage: '.setuclqualification <tournamentKey> <spots>',
    aliases: ['setucl', 'uclspots'],
    hidden: true,

    data: new SlashCommandBuilder()
        .setName('setuclqualification')
        .setDescription('Set league UCL qualification spots')
        .addStringOption(opt =>
            opt.setName('tournament')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('spots')
                .setDescription('Number of UCL spots')
                .setRequired(true)
        ),

    async execute(message, args) {
        if (!message.guild) return;

        if (!(await isOrganizer(
            message.guild.id,
            message.author.id
        ))) {
            return message.reply('🚫 Unauthorized.');
        }

        const tournamentKey =
            args[0]?.toLowerCase();

        const spots =
            Number(args[1]);

        if (
            !tournamentKey ||
            Number.isNaN(spots) ||
            spots < 0
        ) {
            return message.reply(
                '❓ Usage: `.setuclqualification <tournamentKey> <spots>`'
            );
        }

        return updateUclQualification({
            guildId: message.guild.id,
            tournamentKey,
            spots,
            reply: payload => message.reply(payload)
        });
    },

    async slashExecute(interaction) {
        if (!(await isOrganizer(
            interaction.guild.id,
            interaction.user.id
        ))) {
            return interaction.reply({
                content: '🚫 Unauthorized.',
                ephemeral: true
            });
        }

        const tournamentKey =
            interaction.options
                .getString('tournament')
                .toLowerCase();

        const spots =
            interaction.options
                .getInteger('spots');

        return updateUclQualification({
            guildId: interaction.guild.id,
            tournamentKey,
            spots,
            reply: payload =>
                interaction.reply(payload)
        });
    }
};

async function updateUclQualification({
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
                    uclQualificationSpots: spots
                }
            },
            {
                new: true
            }
        );

    if (!tournament) {
        return reply({
            content:
                `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🔵 UCL QUALIFICATION UPDATED')
        .setDescription(
            `Tournament: **${tournament.name}**\n\n` +
            `League UCL Qualification Spots: **${spots}**`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}
