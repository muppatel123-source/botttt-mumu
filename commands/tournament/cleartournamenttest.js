const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    Fixture,
    TournamentSettings,
    TournamentTeam,
    TournamentPlayer,
    UserProfile
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'cleartournamenttest',
    description: 'Remove seeded TEST tournament data only.',
    usage: '.cleartournamenttest confirm',
    aliases: ['cleartest', 'clearseed', 'wipetesttour'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('cleartournamenttest')
        .setDescription('Remove seeded TEST data only')
        .addBooleanOption(opt =>
            opt.setName('confirm')
                .setDescription('Required safety confirmation')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 Unauthorized.');
            }

            if (args[0]?.toLowerCase() !== 'confirm') {
                return message.reply('⚠️ Use `.cleartournamenttest confirm`');
            }

            return await runClear({
                guild: message.guild,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('cleartournamenttest prefix error:', error);
            return message.reply('❌ Failed to clear test data.');
        }
    },

    async slashExecute(interaction) {
        try {
            if (!(await isOrganizer(interaction.guild.id, interaction.user.id))) {
                return interaction.reply({ content: '🚫 Unauthorized.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            if (!interaction.options.getBoolean('confirm')) {
                return interaction.editReply('⚠️ Set confirm to true.');
            }

            return await runClear({
                guild: interaction.guild,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('cleartournamenttest slash error:', error);
            return interaction.editReply('❌ Failed to clear test data.');
        }
    }
};

async function runClear({ guild, reply }) {
    const testTournaments = await TournamentSettings.find({
        guildId: guild.id,
        $or: [
            { tournamentKey: /^test/i },
            { name: /^TEST /i }
        ]
    });

    const testTeams = await Team.find({
        guildId: guild.id,
        name: /^TEST /i
    });

    if (!testTournaments.length && !testTeams.length) {
        return reply({ content: 'ℹ️ No TEST data found.' });
    }

    const tournamentIds = testTournaments.map(t => t._id);
    const tournamentKeys = testTournaments.map(t => t.tournamentKey);

    const teamIds = testTeams.map(team => team._id);
    const teamNames = testTeams.map(team => team.name);

    const playerDelete = await Player.deleteMany({
        guildId: guild.id,
        $or: [
            { teamId: { $in: teamIds } },
            { teamNameSnapshot: { $in: teamNames } },
            { name: /^TEST /i }
        ]
    });

    const tournamentPlayerDelete = await TournamentPlayer.deleteMany({
        guildId: guild.id,
        $or: [
            { tournamentId: { $in: tournamentIds } },
            { teamId: { $in: teamIds } },
            { teamNameSnapshot: { $in: teamNames } },
            { playerNameSnapshot: /^TEST /i }
        ]
    });

    const tournamentTeamDelete = await TournamentTeam.deleteMany({
        guildId: guild.id,
        $or: [
            { tournamentId: { $in: tournamentIds } },
            { teamId: { $in: teamIds } },
            { teamNameSnapshot: { $in: teamNames } }
        ]
    });

    const fixtureDelete = await Fixture.deleteMany({
        guildId: guild.id,
        $or: [
            { tournamentId: { $in: tournamentIds } },
            { tournamentKey: { $in: tournamentKeys } },
            { homeTeamId: { $in: teamIds } },
            { awayTeamId: { $in: teamIds } },
            { homeTeam: { $in: teamNames } },
            { awayTeam: { $in: teamNames } }
        ]
    });

    const userProfileUpdate = await UserProfile.updateMany(
        {
            guildId: guild.id
        },
        {
            $pull: {
                trophies: {
                    $or: [
                        { tournamentKey: { $in: tournamentKeys } },
                        { teamName: { $in: teamNames } }
                    ]
                },
                awards: {
                    tournamentKey: { $in: tournamentKeys }
                }
            }
        }
    ).catch(() => ({ modifiedCount: 0 }));

    const teamDelete = await Team.deleteMany({
        guildId: guild.id,
        _id: { $in: teamIds }
    });

    const tournamentDelete = await TournamentSettings.deleteMany({
        guildId: guild.id,
        _id: { $in: tournamentIds }
    });

    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🧹 TEST DATA CLEARED')
        .addFields(
            { name: 'Test Tournaments Removed', value: `**${tournamentDelete.deletedCount || 0}**`, inline: true },
            { name: 'Test Teams Removed', value: `**${teamDelete.deletedCount || 0}**`, inline: true },
            { name: 'Players Removed', value: `**${playerDelete.deletedCount || 0}**`, inline: true },
            { name: 'Tournament Teams Removed', value: `**${tournamentTeamDelete.deletedCount || 0}**`, inline: true },
            { name: 'Tournament Players Removed', value: `**${tournamentPlayerDelete.deletedCount || 0}**`, inline: true },
            { name: 'Fixtures Removed', value: `**${fixtureDelete.deletedCount || 0}**`, inline: true },
            { name: 'Profiles Cleaned', value: `**${userProfileUpdate.modifiedCount || 0}**`, inline: true }
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}