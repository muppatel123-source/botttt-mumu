const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    SlashCommandBuilder,
    StringSelectMenuBuilder
} = require('discord.js');

const {
    TournamentTeam
} = require('../../models/Tournament');

const {
    getDefaultTournament,
    getSelectableTournaments,
    getTournamentByKey
} = require('../../utils/getTournament');

module.exports = {
    name: 'standings-hf',
    description: 'View standings for a tournament or group.',
    aliases: ['standingshf', 'groupstandings', 'standings', 'table'],

    data: new SlashCommandBuilder()
        .setName('standings-hf')
        .setDescription('View standings')
        .addStringOption(opt =>
            opt.setName('group')
                .setDescription('Optional group key like A, B, C...')
                .setRequired(false)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const requestedGroup = args[0] ? args[0].toUpperCase() : null;

            return await runStandings({
                guild: message.guild,
                requestedGroup,
                userId: message.author.id,
                reply: payload => message.channel.send(payload)
            });
        } catch (error) {
            console.error('standings-hf prefix error:', error);
            return message.reply('❌ Failed to load standings.');
        }
    },

    async slashExecute(interaction) {
        try {
            const requestedGroup = interaction.options.getString('group')?.toUpperCase() || null;

            return await runStandings({
                guild: interaction.guild,
                requestedGroup,
                userId: interaction.user.id,
                reply: payload => interaction.reply(payload)
            });
        } catch (error) {
            console.error('standings-hf slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply({ content: '❌ Failed to load standings.' });
            }

            return interaction.reply({
                content: '❌ Failed to load standings.',
                ephemeral: true
            });
        }
    }
};

async function runStandings({
    guild,
    requestedGroup,
    userId,
    reply
}) {
    if (!guild) {
        return reply({ content: '❌ This command can only be used in a server.' });
    }

    const tournaments = await getSelectableTournaments(guild.id);

    if (!tournaments.length) {
        return reply({ content: '📭 No active tournaments found.' });
    }

    let tournament = await getDefaultTournament(guild.id);
    if (!tournament) tournament = tournaments[0];

    let selectedGroup = requestedGroup || getFirstGroup(tournament);
    let selectedTournamentKey = tournament.tournamentKey;

    const payload = await buildStandingsPayload({
        guildId: guild.id,
        tournament,
        tournaments,
        selectedGroup
    });

    const sent = await reply(payload);

    if (!sent?.createMessageComponentCollector) return;

    const collector = sent.createMessageComponentCollector({
        time: 600000
    });

    collector.on('collect', async interaction => {
        try {
            if (interaction.user.id !== userId) {
                return interaction.reply({
                    content: 'Not your menu.',
                    ephemeral: true
                });
            }

            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'standings_tournament') {
                    selectedTournamentKey = interaction.values[0];
                    tournament = await getTournamentByKey(guild.id, selectedTournamentKey);
                    selectedGroup = getFirstGroup(tournament);
                }
            }

            if (interaction.isButton()) {
                if (interaction.customId.startsWith('standings_group_')) {
                    selectedGroup = interaction.customId.replace('standings_group_', '');
                }

                if (interaction.customId === 'standings_overall') {
                    selectedGroup = null;
                }
            }

            const updatedPayload = await buildStandingsPayload({
                guildId: guild.id,
                tournament,
                tournaments,
                selectedGroup
            });

            await interaction.update(updatedPayload);
        } catch (error) {
            console.error('standings collector error:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Failed to switch standings view.',
                    ephemeral: true
                }).catch(() => null);
            }
        }
    });

    collector.on('end', async () => {
        await sent.edit({ components: [] }).catch(() => null);
    });
}

async function buildStandingsPayload({
    guildId,
    tournament,
    tournaments,
    selectedGroup
}) {
    const table = await generateTable({
        guildId,
        tournament,
        groupKey: selectedGroup
    });

    const components = [
        buildTournamentDropdown(tournaments, tournament.tournamentKey)
    ];

    const groupButtons = buildGroupButtons(tournament, selectedGroup);

    if (groupButtons) {
        components.push(groupButtons);
    }

    return {
        content: table,
        components
    };
}

async function generateTable({
    guildId,
    tournament,
    groupKey
}) {
    const query = {
        guildId,
        tournamentId: tournament._id,
        isActive: true
    };

    if (groupKey) {
        query.groupKey = groupKey;
    }

    let teams = await TournamentTeam.find(query)
        .populate('teamId')
        .lean();

    if (!teams.length) {
        return groupKey
            ? `🏟️ **${tournament.name} — Group ${groupKey}** has no active teams yet.`
            : `🏟️ **${tournament.name}** has no active teams yet.`;
    }

    teams = sortTeams(teams);

    const qualificationCount = groupKey
        ? inferQualificationCount(tournament, teams.length)
        : 0;

    let table = groupKey
        ? `🏆 **${tournament.name.toUpperCase()} — GROUP ${groupKey} STANDINGS**\n`
        : `🏆 **${tournament.name.toUpperCase()} — STANDINGS**\n`;

    table += `Key: \`${tournament.tournamentKey}\`\n`;
    table += '```ansi\n';
    table += `\u001b[1;37mPos Team         P  GD  Pts\u001b[0m\n`;
    table += `-----------------------------\n`;

    teams.forEach((entry, index) => {
        const stats = entry.stats || {};
        const gd = (stats.gf || 0) - (stats.ga || 0);
        const isQualified = qualificationCount > 0 && index < qualificationCount;

        const colorCode = isQualified
            ? '\u001b[1;32m'
            : groupKey
                ? '\u001b[1;31m'
                : '\u001b[1;36m';

        const pos = String(index + 1).padEnd(3, ' ');
        const name = compactName(entry.teamNameSnapshot || entry.teamId?.name || 'Unknown', 12).padEnd(12, ' ');
        const played = String(stats.played || 0).padEnd(2, ' ');
        const gdStr = `${gd >= 0 ? '+' : ''}${gd}`.padEnd(3, ' ');
        const pts = String(stats.points || 0);

        table += `${colorCode}${pos} ${name} ${played} ${gdStr} ${pts}\u001b[0m\n`;

        if (
            qualificationCount > 0 &&
            index === qualificationCount - 1 &&
            teams.length > qualificationCount
        ) {
            table += `\u001b[1;30m-----------------------------\u001b[0m\n`;
        }
    });

    table += `-----------------------------\n`;

    if (qualificationCount > 0) {
        table += `\u001b[1;32mGreen\u001b[0m = Qualification zone\n`;
    }

    table += '```';

    return table;
}

function buildTournamentDropdown(tournaments, selectedKey) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('standings_tournament')
            .setPlaceholder('Select tournament')
            .addOptions(
                tournaments.slice(0, 25).map(tournament => ({
                    label: truncate(tournament.name || tournament.tournamentKey, 80),
                    description: `Key: ${tournament.tournamentKey}`,
                    value: tournament.tournamentKey,
                    default: tournament.tournamentKey === selectedKey
                }))
            )
    );
}

function buildGroupButtons(tournament, selectedGroup) {
    const groupCount = tournament.groupCount || 0;

    if (!groupCount) return null;

    const buttons = [
        new ButtonBuilder()
            .setCustomId('standings_overall')
            .setLabel('Overall')
            .setStyle(!selectedGroup ? ButtonStyle.Success : ButtonStyle.Secondary)
    ];

    const groupKeys = Array.from(
        { length: groupCount },
        (_, i) => String.fromCharCode(65 + i)
    );

    for (const group of groupKeys.slice(0, 4)) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`standings_group_${group}`)
                .setLabel(`Group ${group}`)
                .setStyle(selectedGroup === group ? ButtonStyle.Success : ButtonStyle.Primary)
        );
    }

    return new ActionRowBuilder().addComponents(...buttons);
}

function getFirstGroup(tournament) {
    return (tournament.groupCount || 0) > 0 ? 'A' : null;
}

function inferQualificationCount(settings) {
    if (!settings?.hasKnockout) {
        return 0;
    }

    return settings.qualificationSpotsPerGroup || 2;
}

function sortTeams(teams) {
    return [...teams].sort((a, b) => {
        const aStats = a.stats || {};
        const bStats = b.stats || {};

        const aPoints = aStats.points || 0;
        const bPoints = bStats.points || 0;
        if (bPoints !== aPoints) return bPoints - aPoints;

        const aGD = (aStats.gf || 0) - (aStats.ga || 0);
        const bGD = (bStats.gf || 0) - (bStats.ga || 0);
        if (bGD !== aGD) return bGD - aGD;

        const aGF = aStats.gf || 0;
        const bGF = bStats.gf || 0;
        if (bGF !== aGF) return bGF - aGF;

        const aName = a.teamNameSnapshot || a.teamId?.name || '';
        const bName = b.teamNameSnapshot || b.teamId?.name || '';

        return aName.localeCompare(bName);
    });
}

function compactName(name, maxLen = 12) {
    if (!name) return 'Unknown';
    return name.length > maxLen ? name.slice(0, maxLen - 2) + '..' : name;
}

function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? value.slice(0, max - 3) + '...' : value;
}
