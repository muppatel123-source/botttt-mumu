const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const { Player, Team } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'admin-addplayer',
    description: 'Add a global player to any team as an organizer.',
    usage: '.admin-addplayer <team name> @user <player display name>',
    aliases: ['forceaddplayer', 'aap'],
    hidden: true,
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('admin-addplayer')
        .setDescription('Add a global player to any team as organizer')
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Discord user to link')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('player_name')
                .setDescription('Player display name')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            const mentioned = message.mentions.users.first();

            if (!mentioned) {
                return message.reply('❌ Usage: `.admin-addplayer <team name> @user <player display name>`');
            }

            const mentionIndex = args.findIndex(arg => /\d{17,20}/.test(arg));

            if (mentionIndex === -1) {
                return message.reply('❌ Could not detect mentioned user.');
            }

            const teamName = args.slice(0, mentionIndex).join(' ').trim();
            const playerName = args.slice(mentionIndex + 1).join(' ').trim();

            if (!teamName || !playerName) {
                return message.reply('❌ Usage: `.admin-addplayer <team name> @user <player display name>`');
            }

            return await runAdminAddPlayer({
                guild: message.guild,
                teamName,
                userId: mentioned.id,
                playerName,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('admin-addplayer prefix error:', error);
            return message.reply('❌ Failed to add player.');
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

            return await runAdminAddPlayer({
                guild: interaction.guild,
                teamName: interaction.options.getString('team'),
                userId: interaction.options.getUser('user').id,
                playerName: interaction.options.getString('player_name'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('admin-addplayer slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply({ content: '❌ Failed to add player.' });
            }

            return interaction.reply({
                content: '❌ Failed to add player.',
                ephemeral: true
            });
        }
    }
};

async function runAdminAddPlayer({
    guild,
    teamName,
    userId,
    playerName,
    reply
}) {
    const team = await Team.findOne({
        guildId: guild.id,
        name: {
            $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
        }
    });

    if (!team) {
        return reply({ content: `❌ Team not found: \`${teamName}\`` });
    }

    const existing = await Player.findOne({
        guildId: guild.id,
        discordID: userId
    });

    if (existing) {
        return reply({
            content:
                `❌ This user is already linked as **${existing.name}**` +
                `${existing.teamNameSnapshot ? ` in **${existing.teamNameSnapshot}**` : ''}.`
        });
    }

    const player = await Player.create({
        guildId: guild.id,
        name: playerName,
        discordID: userId,
        teamId: team._id,
        teamNameSnapshot: team.name,
        isCaptain: false
    });

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ GLOBAL PLAYER ADDED')
        .setDescription(
            `**${player.name}** has been added to **${team.name}**.\n\n` +
            `Linked user: <@${userId}>\n\n` +
            `Use \`.addplayertotournament <key> @user\` if this player should be added to a specific tournament manually.`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}