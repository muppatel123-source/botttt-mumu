const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'embargo',
    aliases: ['gtfo'],
    description: 'Permanently bar a user from using the bot. (Owner only)',
    hidden: true,
    
    data: new SlashCommandBuilder()
        .setName('embargo')
        .setDescription('Bar a user from the bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('target').setDescription('The fraud to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(true)),

    async execute(message, args) {
        if (message.author.id !== process.env.OWNER_ID) return;
        const target = message.mentions.users.first();
        const reason = args.slice(1).join(' ');
        await this.runEmbargo(message, target, reason, false);
    },

    async slashExecute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) return interaction.reply({ content: "❌ Owner only.", ephemeral: true });
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason');
        await this.runEmbargo(interaction, target, reason, true);
    },

    async runEmbargo(input, target, reason, isSlash) {
        if (!target) return isSlash ? input.reply("❌ Tag a user.") : input.reply("❌ Tag a user.");

        // Save to Database
        await input.client.db.blacklist.updateOne(
            { userId: target.id },
            { $set: { userId: target.id, reason: reason, date: new Date() } },
            { upsert: true }
        );

        const embed = new EmbedBuilder()
            .setColor('#FF0000') // Pure Aggressive Red
            .setTitle('🖥️ VAR REVIEW: OVERTURNED')
            .setThumbnail('https://i.imgur.com/8E9v6I6.png') // Use a "Red Card" or "Banned" image URL
            .setDescription(`## 🚫 ACCESS DENIED: FRAUD DETECTED\n🛑 **HALT!** <@${target.id}> has been caught attempting to compromise the integrity of the bot.`)
            .addFields(
                { name: '📝 Reason for Sentence', value: `\`${reason}\``, inline: false },
                { name: '📉 Current Status', value: '` EXILED TO THE KITCHEN `', inline: true },
                { name: '⚖️ Sentence', value: '` PERMANENT BOT EMBARGO `', inline: true }
            )
            .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3ZleHlzbmZ4bmZ4bmZ4bmZ4bmZ4bmZ4bmZ4bmZ4bmZ4bmZ4bmZ4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/l2SpUepuM4dVX4DQ4/giphy.gif') // Classic "Exit" or "Red Card" GIF
            .setFooter({ text: 'The Crown sees everything. Don\'t cheat the grind.' })
            .setTimestamp();

        return isSlash ? input.reply({ embeds: [embed] }) : input.reply({ embeds: [embed] });
    }
};