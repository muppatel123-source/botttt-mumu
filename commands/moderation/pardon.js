const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'pardon',
    description: 'Lift a bot embargo and restore user access. (Owner only)',
    category: 'owner',
    hidden: true,

    data: new SlashCommandBuilder()
        .setName('pardon')
        .setDescription('Restore bot access to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('target').setDescription('The user to pardon').setRequired(true)),

    async execute(message, args) {
        if (message.author.id !== process.env.OWNER_ID) return;
        const target = message.mentions.users.first();
        await this.runPardon(message, target, false);
    },

    async slashExecute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: "❌ This is a restricted owner command.", ephemeral: true });
        }
        const target = interaction.options.getUser('target');
        await this.runPardon(interaction, target, true);
    },

    async runPardon(input, target, isSlash) {
        if (!target) return isSlash ? input.reply("❌ Specify a user.") : input.reply("❌ Specify a user.");

        // 🗑️ Remove from Blacklist Database
        const result = await input.client.db.blacklist.deleteOne({ userId: target.id });

        if (result.deletedCount === 0) {
            const noBan = `⚠️ <@${target.id}> was not under an embargo.`;
            return isSlash ? input.reply({ content: noBan, ephemeral: true }) : input.reply(noBan);
        }

        const embed = new EmbedBuilder()
            .setColor('#2ECC71') // Mercy Green
            .setTitle('⚖️ VAR REVIEW: DECISION REVERSED')
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .setDescription(`## ✅ ACCESS RESTORED: PARDON GRANTED\n<@${target.id}> has been cleared by the Crown. The embargo has been lifted.`)
            .addFields(
                { name: '🛡️ Clearance', value: '` FULL BOT ACCESS `', inline: true }
            )
            .setFooter({ text: 'Don’t make the Crown regret its mercy.' })
            .setTimestamp();

        return isSlash ? input.reply({ embeds: [embed] }) : input.reply({ embeds: [embed] });
    }
};