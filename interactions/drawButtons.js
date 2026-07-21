const { Team } = require('../models/Tournament');
const {
    getDrawKey,
    updatePublicDrawBoard
} = require('../utils/drawBoard');

module.exports = async function handleDrawButtons(interaction, client) {
    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    const customId = interaction.customId;

    if (!customId.startsWith('draw_')) return;

    const drawKey = getDrawKey(interaction.guild.id);
    const session = client.liveSettings.get(drawKey);

    if (!session || session.type !== 'manual_draw' || session.status !== 'active') {
        return interaction.reply({
            content: '❌ No active draw session found.',
            ephemeral: true
        });
    }

    if (interaction.user.id !== session.startedBy) {
        return interaction.reply({
            content: '🚫 Only the organizer who started this draw can use these buttons.',
            ephemeral: true
        });
    }

    try {
        if (customId.startsWith('draw_pick_')) {
            return await handleDrawPick(interaction, client, drawKey, session);
        }

        if (customId.startsWith('draw_place_')) {
            return await handleGroupPlacement(interaction, client, drawKey, session);
        }
    } catch (error) {
        console.error('drawButtons.js error:', error);

        if (interaction.replied || interaction.deferred) {
            return interaction.editReply({
                content: '❌ Draw interaction failed.'
            });
        }

        return interaction.reply({
            content: '❌ Draw interaction failed.',
            ephemeral: true
        });
    }
};

async function handleDrawPick(interaction, client, drawKey, session) {
    if (!session.pool || !session.pool.length) {
        return interaction.reply({
            content: '❌ No teams left in the draw pool.',
            ephemeral: true
        });
    }

    if (session.stage === 'groups' && session.currentPick) {
        return interaction.reply({
            content:
                `❌ A team is already waiting for placement:\n` +
                `**${session.currentPick.name}**`,
            ephemeral: true
        });
    }

    if (session.stage === 'knockout' && session.currentPick && session.ties.length >= session.requiredPairs) {
        return interaction.reply({
            content: '❌ All required ties are already completed.',
            ephemeral: true
        });
    }

    const randomIndex = Math.floor(Math.random() * session.pool.length);
    const pickedTeam = session.pool[randomIndex];

    session.pool.splice(randomIndex, 1);

    if (session.stage === 'groups') {
        session.currentPick = {
            ...pickedTeam,
            drawnAt: Date.now()
        };

        session.notes.push({
            type: 'group_draw_pick',
            teamName: pickedTeam.name,
            at: Date.now()
        });

        client.liveSettings.set(drawKey, session);
        await updatePublicDrawBoard(client, session);

        return interaction.reply({
            content:
                `🎟️ **${pickedTeam.name}** has been drawn.\n` +
                `Now place them into a group.`,
            ephemeral: true
        });
    }

    // knockout mode
    if (!session.currentPick) {
        session.currentPick = {
            ...pickedTeam,
            drawnAt: Date.now()
        };

        session.notes.push({
            type: 'knockout_first_pick',
            teamName: pickedTeam.name,
            at: Date.now()
        });

        client.liveSettings.set(drawKey, session);
        await updatePublicDrawBoard(client, session);

        return interaction.reply({
            content:
                `🎟️ **${pickedTeam.name}** has been drawn as the first team of the next tie.\n` +
                `Click another draw button to reveal the opponent.`,
            ephemeral: true
        });
    }

    const firstTeam = session.currentPick;
    const secondTeam = {
        ...pickedTeam,
        drawnAt: Date.now()
    };

    const completedTie = {
        tieNumber: session.ties.length + 1,
        team1: firstTeam,
        team2: secondTeam,
        at: Date.now()
    };

    session.ties.push(completedTie);
    session.currentPick = null;

    session.notes.push({
        type: 'knockout_tie_completed',
        tieNumber: completedTie.tieNumber,
        team1: firstTeam.name,
        team2: secondTeam.name,
        at: Date.now()
    });

    client.liveSettings.set(drawKey, session);
    await updatePublicDrawBoard(client, session);

    return interaction.reply({
        content:
            `🎯 **Tie ${completedTie.tieNumber} completed**\n` +
            `**${firstTeam.name}** vs **${secondTeam.name}**`,
        ephemeral: true
    });
}

async function handleGroupPlacement(interaction, client, drawKey, session) {
    if (session.stage !== 'groups') {
        return interaction.reply({
            content: '❌ Placement buttons are only valid during group draws.',
            ephemeral: true
        });
    }

    if (!session.currentPick) {
        return interaction.reply({
            content: '❌ No drawn team is waiting for placement.',
            ephemeral: true
        });
    }

    const groupKey = interaction.customId.replace('draw_place_', '');
    if (!session.groups[groupKey]) {
        return interaction.reply({
            content: `❌ Invalid group: ${groupKey}`,
            ephemeral: true
        });
    }

    const teamsPerGroup = session.settingsSnapshot?.teamsPerGroup || 0;
    if (teamsPerGroup > 0 && session.groups[groupKey].length >= teamsPerGroup) {
        return interaction.reply({
            content: `❌ Group ${groupKey} is already full.`,
            ephemeral: true
        });
    }

    const placedTeam = session.currentPick;

    session.groups[groupKey].push(placedTeam);
    session.currentPick = null;

    session.picks.push({
        type: 'group_placement',
        teamName: placedTeam.name,
        teamId: placedTeam.teamId,
        groupKey,
        at: Date.now()
    });

    client.liveSettings.set(drawKey, session);

    await Team.updateOne(
        { _id: placedTeam.teamId, guildId: interaction.guild.id },
        { $set: { groupKey } }
    ).catch(() => null);

    await updatePublicDrawBoard(client, session);

    return interaction.reply({
        content: `✅ **${placedTeam.name}** placed into **Group ${groupKey}**.`,
        ephemeral: true
    });
}