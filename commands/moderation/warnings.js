const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'warnings',
  aliases: ['warns', 'checkwarns'],
  category: 'moderation',
  description: 'Pro-Level Surgical Warning Dashboard.',
  async execute(message, args) {
    let target = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(() => null) : message.author);
    if (!target) return message.reply("❓ **User not found.**");

    const guildId = message.guild.id;
    const key = `${guildId}-${target.id}`;
    
    let warnData = message.client.warnings.get(key) || { count: 0, warnings: [] };
    let currentPage = 0;

    const createEmbed = (page) => {
      const warn = warnData.warnings[page];
      const avatar = target.displayAvatarURL({ dynamic: true });
      
      const embed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setAuthor({ name: `Infraction Record: ${target.username}`, iconURL: avatar })
        .setThumbnail(avatar)
        .setFooter({ text: `Case ${page + 1} of ${warnData.warnings.length} • ID: ${target.id}` })
        .setTimestamp();

      if (warn) {
        embed.addFields(
            { name: '📝 **Reason**', value: `\`\`\`${warn.reason}\`\`\``, inline: false },
            { name: '🛡️ **Moderator**', value: `${warn.moderator}`, inline: true },
            { name: '📅 **Date**', value: `${warn.timestamp || 'Unknown'}`, inline: true }
        );
      } else {
        embed.setDescription("✨ **This user has a completely clean record.**");
      }
      return embed;
    };

    const getRows = (page) => {
      const rows = [];
      const total = warnData.warnings.length;

      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('first').setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('prev').setEmoji('⬅️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('next').setEmoji('➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= total - 1 || total === 0),
        new ButtonBuilder().setCustomId('last').setEmoji('⏩').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1 || total === 0)
      );
      rows.push(navRow);

      if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.author.id === process.env.OWNER_ID) {
        const dangerRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('del_case').setLabel('Delete Case').setEmoji('✂️').setStyle(ButtonStyle.Danger).setDisabled(total === 0),
          new ButtonBuilder().setCustomId('clear').setLabel('Clear All').setEmoji('☢️').setStyle(ButtonStyle.Danger).setDisabled(total === 0)
        );
        rows.push(dangerRow);
      }
      return rows;
    };

    const mainMsg = await message.reply({ 
        embeds: [createEmbed(currentPage)], 
        components: warnData.warnings.length > 0 ? getRows(currentPage) : [] 
    });

    const collector = mainMsg.createMessageComponentCollector({ time: 300000 });

    collector.on('collect', async i => {
      // 🛡️ SECURITY CHECK: Ephemeral reply for unauthorized users
      if (i.user.id !== message.author.id) {
        return i.reply({ content: "❌ **Access Denied.** Only the command requester can navigate this menu.", ephemeral: true });
      }

      try {
        const total = warnData.warnings.length;

        if (i.customId === 'first') currentPage = 0;
        if (i.customId === 'last') currentPage = total - 1;
        if (i.customId === 'prev') currentPage--;
        if (i.customId === 'next') currentPage++;

        if (i.customId === 'del_case') {
          warnData.warnings.splice(currentPage, 1);
          warnData.count = warnData.warnings.length;
          message.client.warnings.set(key, warnData);
          if (currentPage >= warnData.warnings.length) currentPage = Math.max(0, warnData.warnings.length - 1);
        }

        if (i.customId === 'clear') {
          message.client.warnings.delete(key);
          warnData = { count: 0, warnings: [] };
          return i.update({ embeds: [createEmbed(0)], components: [] });
        }

        await i.update({ 
            embeds: [createEmbed(currentPage)], 
            components: warnData.warnings.length > 0 ? getRows(currentPage) : [] 
        });

      } catch (err) {
        console.error("Collector Error:", err);
        // This catch ensures the bot doesn't die if something goes wrong
      }
    });
  },
};