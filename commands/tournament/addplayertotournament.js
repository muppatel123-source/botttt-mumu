const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    Player,
    Team,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { syncPlayerToTournament } = require('../../utils/tournamentSync');

module.exports = {
    name: 'addplayertotournament',
    description: 'Manually add/re-add a player to a tournament.',
    usage: '.addplayertotournament <key> @user',
    aliases: ['aptt', 'jointournamentplayer'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('addplayertotournament')
        .setDescription('Add a player to a tournament')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Player user')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            const user = message.mentions.users.first();

            if (!args.length || !user) {
                return message.reply('❓ Usage: `.addplayertotournament <key> @user`');
            }

            return await runAdd({
                guild: message.guild,
                tournamentKey: args[0].toLowerCase(),
                discordID: user.id,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('addplayertotournament prefix error:', error);
            return message.reply('❌ Failed to add player to tournament.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({
                    content: '🚫 You are not authorized.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            return await runAdd({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                discordID: interaction.options.getUser('user').id,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('addplayertotournament slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to add player.');
            }

            return interaction.reply({
                content: '❌ Failed to add player.',
                ephemeral: true
            });
        }
    }
};

async function runAdd({
    guild,
    tournamentKey,
    discordID,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const player = await Player.findOne({
        guildId: guild.id,
        discordID
    });

    if (!player) {
        return reply({
            content: '❌ Global player profile not found.'
        });
    }

    const team = await Team.findOne({
        guildId: guild.id,
        _id: player.teamId
    });

    if (!team) {
        return reply({
            content: '❌ Player team not found.'
        });
    }

    await syncPlayerToTournament(
        guild.id,
        tournament,
        player,
        team
    );

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ PLAYER ADDED TO TOURNAMENT')
        .setDescription(
            `**${player.name}** has been added to **${tournament.name}**.\n\n` +
            `👤 Linked User: <@${discordID}>\n` +
            `🏟️ Team: **${team.name}**\n` +
            `🏆 Tournament: \`${tournament.tournamentKey}\``
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}