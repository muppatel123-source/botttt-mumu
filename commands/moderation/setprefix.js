const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const {
    setGuildPrefix,
    getGuildPrefix,
    DEFAULT_PREFIX
} = require('../../utils/prefixManager');

const { OWNER_IDS } = require('../../utils/isOrganizer');

module.exports = {
    name: 'setprefix',
    description: 'Change the bot prefix for this server.',
    usage: '.setprefix <prefix>',
    cooldown: 3,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('setprefix')
        .setDescription('Change the bot prefix for this server')
        .addStringOption(opt =>
            opt.setName('prefix')
                .setDescription('New prefix, max 3 characters')
                .setRequired(true)
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            const allowed =
                OWNER_IDS.includes(message.author.id) ||
                message.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!allowed) {
                return message.reply(
                    '<a:Cross_:1486728686005649650> You need **Administrator** permissions to change my prefix.'
                );
            }

            const newPrefix = args[0];

            if (!newPrefix) {
                const currentPrefix = await getGuildPrefix(message.guild.id);

                return message.reply(
                    `<a:CAUTION:1486728415015993477> Please provide a new prefix!\n` +
                    `Current prefix: \`${currentPrefix}\`\n` +
                    `Example: \`${currentPrefix}setprefix !\``
                );
            }

            const validation = validatePrefix(newPrefix);

            if (!validation.ok) {
                return message.reply(validation.message);
            }

            await setGuildPrefix(message.guild.id, newPrefix);

            return message.reply({
                content:
                    `<:tick:1486733833419358339> **Success!** ` +
                    `The prefix for this server is now: \`${newPrefix}\`\n\n` +
                    `From now on, use \`${newPrefix}\` instead of \`${DEFAULT_PREFIX}\`.`
            });
        } catch (error) {
            console.error('setprefix prefix error:', error);
            return message.reply('❌ Failed to update prefix.');
        }
    },

    async slashExecute(interaction) {
        try {
            const allowed =
                OWNER_IDS.includes(interaction.user.id) ||
                interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!allowed) {
                return interaction.reply({
                    content: '<a:Cross_:1486728686005649650> You need **Administrator** permissions to change my prefix.',
                    ephemeral: true
                });
            }

            const newPrefix = interaction.options.getString('prefix');

            const validation = validatePrefix(newPrefix);

            if (!validation.ok) {
                return interaction.reply({
                    content: validation.message,
                    ephemeral: true
                });
            }

            await setGuildPrefix(interaction.guild.id, newPrefix);

            return interaction.reply({
                content:
                    `<:tick:1486733833419358339> **Success!** ` +
                    `The prefix for this server is now: \`${newPrefix}\`\n\n` +
                    `From now on, use \`${newPrefix}\` instead of \`${DEFAULT_PREFIX}\`.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('setprefix slash error:', error);

            if (interaction.replied || interaction.deferred) {
                return interaction.editReply('❌ Failed to update prefix.');
            }

            return interaction.reply({
                content: '❌ Failed to update prefix.',
                ephemeral: true
            });
        }
    }
};

function validatePrefix(prefix) {
    if (!prefix) {
        return {
            ok: false,
            message: '<a:CAUTION:1486728415015993477> Please provide a new prefix.'
        };
    }

    if (/\s/.test(prefix)) {
        return {
            ok: false,
            message: '<a:CAUTION:1486728415015993477> Prefix cannot contain spaces.'
        };
    }

    if (prefix.length > 3) {
        return {
            ok: false,
            message: '<a:CAUTION:1486728415015993477> Prefixes must be 3 characters or less.'
        };
    }

    if (prefix.startsWith('/')) {
        return {
            ok: false,
            message: '<a:CAUTION:1486728415015993477> Prefix cannot start with `/` because slash commands already use that.'
        };
    }

    return { ok: true };
}
