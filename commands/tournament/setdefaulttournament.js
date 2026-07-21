/**
 * setdefaulttournament.js
 *
 * Set the default tournament for this server.
 * Updates ServerConfig.defaultTournamentKey.
 *
 * Usage: .setdefaulttournament <key>
 * Slash: /setdefaulttournament key:<key>
 *
 * Aliases: sdt, defaulttour
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    TournamentSettings,
    ServerConfig
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setdefaulttournament',
    description: 'Set the default tournament for this server.',
    usage: '.setdefaulttournament <key>',
    aliases: ['sdt', 'defaulttour'],
    hidden: false,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setdefaulttournament')
        .setDescription('Set the default tournament')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            if (!args.length) {
                return message.reply('❓ Usage: `.setdefaulttournament <key>`');
            }

            return await runSet({
                guild: message.guild,
                tournamentKey: args[0].toLowerCase(),
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[setdefaulttournament] prefix error:', error);
            return message.reply('❌ Failed to set default tournament.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runSet({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[setdefaulttournament] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to set default tournament.');
            }

            return interaction.reply({
                content: '❌ Failed to set default tournament.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

async function runSet({ guild, tournamentKey, reply }) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    await ServerConfig.findOneAndUpdate(
        { guildId: guild.id },
        {
            $set: {
                guildId: guild.id,
                defaultTournamentKey: tournamentKey
            }
        },
        { upsert: true, new: true }
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ DEFAULT TOURNAMENT SET')
        .setDescription(
            `🏆 **${tournament.name}** is now the default tournament.\n\n` +
            `Key: \`${tournament.tournamentKey}\``
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}
