/**
 * addorganizer.js
 *
 * Add a server organizer. Bot owners only.
 * Updates the ServerConfig document for the guild.
 *
 * Usage: .addorganizer @user
 * Slash: /addorganizer user:<user>
 */

const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const { ServerConfig } = require('../../models/Tournament');
const { OWNER_IDS } = require('../../utils/isOrganizer');
const { getUserFromArgs } = require('../../utils/stringHelpers');

module.exports = {
    name: 'addorganizer',
    description: 'Add a server organizer.',
    usage: '.addorganizer @user',
    aliases: ['setorganizer', 'organizeradd'],
    hidden: false,
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('addorganizer')
        .setDescription('Add a server organizer')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to promote')
                .setRequired(true)
        ),

    /* ================================================
       PREFIX
    ================================================ */

    async execute(message) {
        try {
            if (!message.guild) return;

            if (!OWNER_IDS.includes(message.author.id)) {
                return message.reply('🚫 Only bot owners can assign organizers.');
            }

            const user =
                message.mentions.users.first() ||
                await getUserFromArgs(message);

            if (!user) {
                return message.reply('❌ Usage: `.addorganizer @user`');
            }

            return await processOrganizer({
                guildId: message.guild.id,
                user,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('[addorganizer] prefix error:', error);
            return message.reply('❌ Failed to add organizer.');
        }
    },

    /* ================================================
       SLASH
    ================================================ */

    async slashExecute(interaction) {
        try {
            if (!OWNER_IDS.includes(interaction.user.id)) {
                return interaction.reply({
                    content: '🚫 Only bot owners can assign organizers.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const user = interaction.options.getUser('user');

            return await processOrganizer({
                guildId: interaction.guild.id,
                user,
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('[addorganizer] slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ Failed to add organizer.' });
            }

            return interaction.reply({
                content: '❌ Failed to add organizer.',
                ephemeral: true
            });
        }
    }
};

/* ====================================================
   CORE LOGIC
==================================================== */

/**
 * Add a user to the server's organizer list.
 * Creates ServerConfig if it doesn't exist (upsert).
 */
async function processOrganizer({ guildId, user, reply }) {
    const config = await ServerConfig.findOneAndUpdate(
        { guildId },
        {
            $setOnInsert: { guildId },
            $addToSet: { organizerIds: user.id }
        },
        { upsert: true, new: true }
    );

    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ ORGANIZER ADDED')
        .setDescription(`${user} is now a server organizer.`)
        .addFields({
            name: 'Total Organizers',
            value: `**${config.organizerIds?.length || 0}**`,
            inline: true
        })
        .setTimestamp();

    return reply({ embeds: [embed] });
}
