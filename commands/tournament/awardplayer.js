const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');

const {
    Player,
    TournamentSettings,
    UserProfile
} = require('../../models/Tournament');

const { isOrganizer } = require('../../utils/isOrganizer');

const VALID_AWARDS = {
    ballon_dor: '🏆 Ballon d\'Or',
    golden_boot: '⚽ Golden Boot',
    golden_glove: '🧤 Golden Glove',
    playmaker: '🎯 Playmaker'
};

module.exports = {
    name: 'awardplayer',
    description: 'Award a player.',
    usage: '.awardplayer <key> @user <award>',
    aliases: ['giveaward', 'awarduser'],
    hidden: true,
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.SendMessages],

    data: new SlashCommandBuilder()
        .setName('awardplayer')
        .setDescription('Award a player')
        .addStringOption(opt =>
            opt.setName('key')
                .setDescription('Tournament key')
                .setRequired(true)
        )
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('Target user')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('award')
                .setDescription('Award type')
                .setRequired(true)
                .addChoices(
                    { name: 'Ballon d\'Or', value: 'ballon_dor' },
                    { name: 'Golden Boot', value: 'golden_boot' },
                    { name: 'Golden Glove', value: 'golden_glove' },
                    { name: 'Playmaker', value: 'playmaker' }
                )
        ),

    async execute(message, args) {
        try {
            if (!message.guild) return;

            if (!(await isOrganizer(message.guild.id, message.author.id))) {
                return message.reply('🚫 You are not authorized.');
            }

            const user = message.mentions.users.first();
            const award = args[args.length - 1]?.toLowerCase();

            if (!args.length || !user || !VALID_AWARDS[award]) {
                return message.reply(
                    '❓ Usage: `.awardplayer <key> @user <ballon_dor/golden_boot/golden_glove/playmaker>`'
                );
            }

            return await runAward({
                guild: message.guild,
                tournamentKey: args[0].toLowerCase(),
                discordID: user.id,
                awardType: award,
                reply: payload => message.reply(payload)
            });
        } catch (error) {
            console.error('awardplayer prefix error:', error);
            return message.reply('❌ Failed to award player.');
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

            return await runAward({
                guild: interaction.guild,
                tournamentKey: interaction.options.getString('key').toLowerCase(),
                discordID: interaction.options.getUser('user').id,
                awardType: interaction.options.getString('award'),
                reply: payload => interaction.editReply(payload)
            });
        } catch (error) {
            console.error('awardplayer slash error:', error);

            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('❌ Failed to award player.');
            }

            return interaction.reply({
                content: '❌ Failed to award player.',
                ephemeral: true
            });
        }
    }
};

async function runAward({
    guild,
    tournamentKey,
    discordID,
    awardType,
    reply
}) {
    const tournament = await TournamentSettings.findOne({
        guildId: guild.id,
        tournamentKey
    });

    if (!tournament) {
        return reply({
            content: `❌ Tournament \`${tournamentKey}\` not found.`
        });
    }

    const player = await Player.findOne({
        guildId: guild.id,
        discordID
    });

    if (!player) {
        return reply({
            content: '❌ Player not found.'
        });
    }

    await UserProfile.findOneAndUpdate(
        {
            guildId: guild.id,
            discordID
        },
        {
            $setOnInsert: {
                guildId: guild.id,
                discordID,
                displayName: player.name
            },
            $push: {
                awards: {
                    tournamentId: tournament._id,
                    tournamentKey: tournament.tournamentKey,
                    tournamentName: tournament.name,
                    awardType,
                    title: VALID_AWARDS[awardType],
                    awardedAt: new Date()
                }
            }
        },
        {
            upsert: true,
            new: true
        }
    );

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🏅 PLAYER AWARDED')
        .setDescription(
            `👤 Player: **${player.name}**\n` +
            `🏆 Award: **${VALID_AWARDS[awardType]}**\n` +
            `🎯 Tournament: **${tournament.name}**`
        )
        .setTimestamp();

    return reply({
        embeds: [embed]
    });
}