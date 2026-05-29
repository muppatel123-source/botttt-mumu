const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    Team,
    TournamentSettings
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');
const { syncTeamToTournament } = require('../../utils/tournamentSync');

module.exports = {
    name: 'addteamtotournament',
    description: 'Manually add/re-add a team to a tournament.',
    usage: '.addteamtotournament <key> <team name>',
    aliases: ['jointournament', 'jointour', 'att'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('addteamtotournament')
        .setDescription('Manually add/re-add a team to a tournament')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Team name')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('group')
                .setDescription('Optional group key')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            if (args.length < 2) {
                return message.reply('❓ Usage: `.addteamtotournament <key> <team name> [group]`');
            }

            const tournamentKey = args[0].toLowerCase();
            let groupKey = null;
            let teamName = args.slice(1).join(' ').trim();

            const last = args[args.length - 1];
            if (args.length >= 3 && /^[A-Za-z]$/.test(last)) {
                groupKey = last.toUpperCase();
                teamName = args.slice(1, -1).join(' ').trim();
            }

            return await runAdd({
                guild: message.guild,
                tournamentKey,
                teamName,
                groupKey,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('addteamtotournament prefix error:', error);
            return message.reply('❌ Failed to add team to tournament.');
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
                teamName: interaction.options.getString('team'),
                groupKey: interaction.options.getString('group')?.toUpperCase() || null,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('addteamtotournament slash error:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to add team to tournament.');
            }
            return interaction.reply({ content: '❌ Failed to add team to tournament.', ephemeral: true });
        }
    }
};

async function runAdd({ guild, tournamentKey, teamName, groupKey, reply }) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({ content: `❌ Tournament \`${tournamentKey}\` not found.` });
    }

    const team = await Team.findOne({
        guildId: guild.id,
        name: { $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i') }
    });

    if (!team) {
        return reply({ content: `❌ Team **${teamName}** not found.` });
    }

    if (groupKey) {
        team.groupKey = groupKey;
        await team.save();
    }

    const sync = await syncTeamToTournament(guild.id, tournament, team);

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ TEAM ADDED TO TOURNAMENT')
        .setDescription(
            `**${team.name}** has been added to **${tournament.name}**.\n\n` +
            `Tournament Key: \`${tournament.tournamentKey}\`\n` +
            `Players synced: **${sync.playersSynced}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}