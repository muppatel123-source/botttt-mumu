const {
    TournamentSettings,
    TournamentTeam
} = require('../models/Tournament');

const LiveMessage = require('../models/LiveMessage');

async function updateLiveStandings(
    client,
    guildId,
    tournamentKey,
    groupKey = null
) {
    try {
        const settings = await TournamentSettings.findOne({
            guildId,
            tournamentKey
        });

        if (!settings) return false;

        const liveData = await LiveMessage.findOne({
            guildId,
            type: 'standings',
            tournamentKey,
            groupKey: groupKey || null
        });

        if (!liveData) return false;

        const channel = await client.channels.fetch(liveData.channelId).catch(() => null);
        if (!channel) return false;

        const message = await channel.messages.fetch(liveData.messageId).catch(() => null);
        if (!message) return false;

        const query = {
            guildId,
            tournamentId: settings._id,
            isActive: true
        };

        if (groupKey) {
            query.groupKey = groupKey;
        }

        const teams = await TournamentTeam.find(query).lean();

        const content = buildStandingsText({
            settings,
            teams,
            groupKey
        });

        await message.edit({ content });

        return true;
    } catch (error) {
        console.error('updateLiveStandings error:', error);
        return false;
    }
}

async function updateAllLiveStandings(client, guildId) {
    try {
        const liveMessages = await LiveMessage.find({
            guildId,
            type: 'standings'
        });

        for (const live of liveMessages) {
            await updateLiveStandings(
                client,
                guildId,
                live.tournamentKey,
                live.groupKey || null
            );
        }
    } catch (error) {
        console.error('updateAllLiveStandings error:', error);
    }
}

function buildStandingsText({
    settings,
    teams,
    groupKey
}) {
    if (!teams.length) {
        return groupKey
            ? `🏟️ Group ${groupKey} has no teams yet.`
            : '🏟️ No teams are registered yet.';
    }

    const sorted = sortTeams(teams);

    const qualificationCount = inferQualificationCount(settings);

    let text = groupKey
        ? `🏆 **${settings.name.toUpperCase()} — GROUP ${groupKey} LIVE STANDINGS**\n`
        : `🏆 **${settings.name.toUpperCase()} — LIVE STANDINGS**\n`;

    text += `Key: \`${settings.tournamentKey}\`\n`;

    text += '```ansi\n';
    text += '\u001b[1;37mPos Team         P  GD  Pts\u001b[0m\n';
    text += '-----------------------------\n';

    sorted.forEach((team, index) => {
        const stats = team.stats || {};

        const gd = (stats.gf || 0) - (stats.ga || 0);

        const isQualified =
            qualificationCount > 0 &&
            index < qualificationCount;

        const colorCode = isQualified
            ? '\u001b[1;32m'
            : '\u001b[1;31m';

        const pos = String(index + 1).padEnd(3, ' ');
        const name = compactName(
            team.teamNameSnapshot || 'Unknown',
            12
        ).padEnd(12, ' ');

        const played = String(stats.played || 0).padEnd(2, ' ');
        const gdStr = `${gd >= 0 ? '+' : ''}${gd}`.padEnd(3, ' ');
        const pts = String(stats.points || 0);

        text += `${colorCode}${pos} ${name} ${played} ${gdStr} ${pts}\u001b[0m\n`;

        if (
            qualificationCount > 0 &&
            index === qualificationCount - 1 &&
            sorted.length > qualificationCount
        ) {
            text += '\u001b[1;30m-----------------------------\u001b[0m\n';
        }
    });

    text += '-----------------------------\n';

    if (qualificationCount > 0) {
        text += '\u001b[1;32mGreen\u001b[0m = Qualification zone\n';
    }

    text += '```';
    text += `\nLast updated: <t:${Math.floor(Date.now() / 1000)}:R>`;

    return text;
}

function sortTeams(teams) {
    return [...teams].sort((a, b) => {
        const aStats = a.stats || {};
        const bStats = b.stats || {};

        if ((bStats.points || 0) !== (aStats.points || 0)) {
            return (bStats.points || 0) - (aStats.points || 0);
        }

        const aGD = (aStats.gf || 0) - (aStats.ga || 0);
        const bGD = (bStats.gf || 0) - (bStats.ga || 0);

        if (bGD !== aGD) return bGD - aGD;

        if ((bStats.gf || 0) !== (aStats.gf || 0)) {
            return (bStats.gf || 0) - (aStats.gf || 0);
        }

        return (a.teamNameSnapshot || '').localeCompare(
            b.teamNameSnapshot || ''
        );
    });
}

function compactName(name, maxLen = 12) {
    if (!name) return 'Unknown';

    return name.length > maxLen
        ? name.slice(0, maxLen - 2) + '..'
        : name;
}

function inferQualificationCount(settings) {
    if (!settings?.hasKnockout) return 0;

    const groupCount = settings.groupCount || 0;
    const totalTeams = settings.teamCount || 0;

    if (groupCount <= 1) {
        if (totalTeams >= 8) return 4;
        if (totalTeams >= 4) return 2;
        return 1;
    }

    return 2;
}

module.exports = {
    updateLiveStandings,
    updateAllLiveStandings
};