/**
 * changecaptain.js
 *
 * Change the captain of a team. Current captain or vice captain can initiate.
 * Updates global Team, Player, and all TournamentPlayer records.
 * Preserves the vice captain unless the new captain was the VC.
 * Moves the captain Discord role if configured.
 *
 * Usage: .cc @user
 * Slash: /changecaptain user:<user>
 *
 * Aliases: cc, captainchange
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Team,
    Player,
    TournamentPlayer,
    TournamentSettings
} = require('../../models/Tournament');

const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'changecaptain',
    description: 'Change captain of your team.',
    usage: '.cc @user',
    aliases: ['cc', 'captainchange'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('changecaptain')
        .setDescription('Change captain of your team')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('New captain')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            const target = message.mentions.users.first() || await getUserFromArgs(message);

            if (!target) {
                return message.reply('❌ Usage: `.cc @user`');
            }

            return await runChangeCaptain({
                guild: message.guild,
                actorId: message.author.id,
                targetUser: target,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[changecaptain] prefix error:', error);
            return message.reply('❌ Failed to change captain.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });

            const target = interaction.options.getUser('user');

            return await runChangeCaptain({
                guild: interaction.guild,
                actorId: interaction.user.id,
                targetUser: target,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[changecaptain] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to change captain.');
            }

            return interaction.reply({ content: '❌ Failed to change captain.', ephemeral: true });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Change the captain of a team.
 * Validates: actor is captain/VC, target is in the same team.
 * Preserves the vice captain unless the new captain was the VC (promoted).
 */
async function runChangeCaptain({ guild, actorId, targetUser, reply }) {
    // ── Self-change check ──
    if (actorId === targetUser.id) {
        return reply({ content: '❌ You cannot make yourself captain — you already are.' });
    }

    // ── Find actor's player + team ──
    const actorPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: actorId
    }).populate('teamId');

    if (!actorPlayer?.teamId) {
        return reply({ content: '❌ You are not linked to any team.' });
    }

    const team = actorPlayer.teamId;

    const isCaptain =
        String(team.captainID) === String(actorId) ||
        actorPlayer.isCaptain;

    const isViceCaptain =
        String(team.viceCaptainID) === String(actorId) ||
        actorPlayer.isViceCaptain;

    if (!isCaptain && !isViceCaptain) {
        return reply({ content: '❌ Only the team captain or vice captain can use `.cc`.' });
    }

    // ── Find target player ──
    const targetPlayer = await Player.findOne({
        guildId: guild.id,
        discordID: targetUser.id
    });

    if (!targetPlayer) {
        return reply({ content: `❌ ${targetUser} is not registered as a player.` });
    }

    if (!targetPlayer.teamId || String(targetPlayer.teamId) !== String(team._id)) {
        return reply({
            content:
                `❌ ${targetUser} is not in **${team.name}**.\n` +
                'Captaincy can only be given to a player from the same team.'
        });
    }

    // ── Determine if VC should be preserved ──
    // If the new captain was the VC, clear VC (they got promoted).
    // Otherwise, keep the existing VC.
    const targetWasVC =
        String(team.viceCaptainID) === String(targetUser.id) ||
        targetPlayer.isViceCaptain;

    const newViceCaptainID = targetWasVC ? null : team.viceCaptainID;

    // ── Update Team document ──
    await Team.updateOne(
        { _id: team._id },
        {
            $set: {
                captainID: targetUser.id,
                viceCaptainID: newViceCaptainID
            }
        }
    );

    // ── Reset all captain/VC flags in team's global players ──
    await Player.updateMany(
        { guildId: guild.id, teamId: team._id },
        { $set: { isCaptain: false, isViceCaptain: false } }
    );

    // ── Set new captain flags ──
    await Player.updateOne(
        { guildId: guild.id, discordID: targetUser.id },
        { $set: { isCaptain: true, isViceCaptain: false } }
    );

    // ── If there's a remaining VC, restore their flag ──
    if (newViceCaptainID) {
        await Player.updateOne(
            { guildId: guild.id, discordID: newViceCaptainID },
            { $set: { isViceCaptain: true } }
        );
    }

    // ── Update all TournamentPlayer records ──
    await TournamentPlayer.updateMany(
        { guildId: guild.id, teamId: team._id },
        { $set: { isCaptain: false, isViceCaptain: false } }
    );

    await TournamentPlayer.updateMany(
        { guildId: guild.id, playerId: targetPlayer._id },
        { $set: { isCaptain: true, isViceCaptain: false } }
    );

    // ── Restore remaining VC in tournament records ──
    if (newViceCaptainID) {
        const vcGlobalPlayer = await Player.findOne({
            guildId: guild.id,
            discordID: newViceCaptainID
        });

        if (vcGlobalPlayer) {
            await TournamentPlayer.updateMany(
                { guildId: guild.id, playerId: vcGlobalPlayer._id },
                { $set: { isViceCaptain: true } }
            );
        }
    }

    // ── Move captain Discord role ──
    await moveCaptainRole({
        guild,
        oldCaptainId: actorId,
        newCaptainId: targetUser.id
    });

    // ── Response ──
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('👑 CAPTAIN CHANGED')
        .setDescription(
            `Team: **${team.name}**\n\n` +
            `Old Captain: <@${actorId}>\n` +
            `New Captain: ${targetUser}`
        )
        .setTimestamp();

    return reply({ embeds: [embed] });
}

/* ====================================================
   ROLE MANAGEMENT
==================================================== */

/**
 * Move the captain Discord role from old captain to new captain.
 * Reads all tournament settings for the guild to find configured captain roles.
 */
async function moveCaptainRole({ guild, oldCaptainId, newCaptainId }) {
    const settings = await TournamentSettings.find({
        guildId: guild.id,
        captainRoleId: { $exists: true, $ne: '' }
    }).lean();

    // Deduplicate role IDs
    const roleIds = [...new Set(settings.map(t => t.captainRoleId).filter(Boolean))];

    if (!roleIds.length) return;

    const oldMember = await guild.members.fetch(oldCaptainId).catch(() => null);
    const newMember = await guild.members.fetch(newCaptainId).catch(() => null);

    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        if (oldMember?.roles.cache.has(roleId)) {
            await oldMember.roles.remove(roleId).catch(() => null);
        }

        if (newMember && !newMember.roles.cache.has(roleId)) {
            await newMember.roles.add(roleId).catch(() => null);
        }
    }
}
