const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { Team } = require('../../models/Tournament');
const { isOrganizer } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setstadium',
    description: 'Set your team stadium, or set any team stadium as organizer.',
    usage: '.setstadium [team name] <stadium name>',
    aliases: ['stadium'],

    data: new SlashCommandBuilder()
        .setName('setstadium')
        .setDescription('Set team stadium')
        .addStringOption(opt =>
            opt.setName('stadium')
                .setDescription('Home stadium name')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('team')
                .setDescription('Organizer only: team name')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const organizer = await isOrganizer(message.guild.id, message.author.id);

            if (!args.length) {
                return message.reply(
                    '❓ Usage:\n' +
                    'Captain: `.setstadium Santiago Bernabeu`\n' +
                    'Organizer: `.setstadium Falcons Santiago Bernabeu`'
                );
            }

            const parsed = organizer
                ? await parseOrganizerTeamAndValue(message.guild.id, args)
                : {
                    teamName: null,
                    value: args.join(' ').trim()
                };

            return await runSetStadium({
                guild: message.guild,
                userId: message.author.id,
                organizer,
                teamName: parsed.teamName,
                stadiumName: parsed.value,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('setstadium prefix error:', error);
            return message.reply('❌ Failed to update stadium.');
        }
    },

    async slashExecute(interaction) {
        try {
            await interaction.deferReply();

            const organizer = await isOrganizer(interaction.guild.id, interaction.user.id);

            return await runSetStadium({
                guild: interaction.guild,
                userId: interaction.user.id,
                organizer,
                teamName: interaction.options.getString('team'),
                stadiumName: interaction.options.getString('stadium'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('setstadium slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to update stadium.');
            }

            return interaction.reply({
                content: '❌ Failed to update stadium.',
                ephemeral: true
            });
        }
    }
};

async function runSetStadium({
    guild,
    userId,
    organizer,
    teamName,
    stadiumName,
    reply
}) {
    const team = await resolveTeam({
        guild,
        userId,
        organizer,
        teamName
    });

    if (!team) {
        return reply({
            content: organizer && teamName
                ? `❌ Team not found: \`${teamName}\``
                : '🚫 Only **Team Captains** can set their own stadium. Organizers can use `.setstadium <team name> <stadium name>`.'
        });
    }

    const cleanName = String(stadiumName || '').trim();

    if (!cleanName || cleanName.length < 2) {
        return reply({
            content: '❌ Please provide a valid stadium name.'
        });
    }

    if (cleanName.length > 80) {
        return reply({
            content: '❌ Stadium name is too long. Keep it under 80 characters.'
        });
    }

    team.stadium = cleanName;
    await team.save();

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🏟️ STADIUM UPDATED')
        .setDescription(
            `**${team.name}** will now play home matches at:\n` +
            `**${cleanName}**`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

async function parseOrganizerTeamAndValue(guildId, args) {
    const teams = await Team.find({ guildId }).select('name').lean();

    let bestMatch = null;
    let bestLength = 0;

    for (let i = 1; i < args.length; i++) {
        const possibleTeamName = args.slice(0, i).join(' ').trim().toLowerCase();

        const matchedTeam = teams.find(team =>
            team.name.toLowerCase() === possibleTeamName
        );

        if (matchedTeam && i > bestLength) {
            bestMatch = matchedTeam.name;
            bestLength = i;
        }
    }

    if (bestMatch) {
        return {
            teamName: bestMatch,
            value: args.slice(bestLength).join(' ').trim()
        };
    }

    return {
        teamName: null,
        value: args.join(' ').trim()
    };
}

async function resolveTeam({
    guild,
    userId,
    organizer,
    teamName
}) {
    if (organizer && teamName) {
        return Team.findOne({
            guildId: guild.id,
            name: {
                $regex: new RegExp(`^${escapeRegex(teamName)}$`, 'i')
            }
        });
    }

    return Team.findOne({
        guildId: guild.id,
        captainID: userId
    });
}

function escapeRegex(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}