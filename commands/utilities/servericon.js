const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'servericon',
  aliases: ['icon', 'sicon', 'guildicon'],
  description: 'Displays the server icon with a download button',
  execute(message) {
    const { guild } = message;
    
    // 1. Get the Icon URL (Highest quality 1024px)
    const iconURL = guild.iconURL({ dynamic: true, size: 1024 });

    if (!iconURL) {
      return message.reply("<a:Cross_:1486728686005649650> This server does not have an icon set.");
    }

    // 2. Create the Embed
    const iconEmbed = new EmbedBuilder()
      .setColor(0xFEBE10) // Real Madrid Gold
      .setTitle(`<:banner:1486779544710152264> Icon for ${guild.name}`)
      .setImage(iconURL)
      .setFooter({ text: `Requested by ${message.author.username}` })
      .setTimestamp();

    // 3. Create the Download Button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Download Icon')
        .setStyle(ButtonStyle.Link) // Link style opens the URL
        .setURL(iconURL)
        .setEmoji('<:download:1486736181206061106>')
    );

    message.reply({ embeds: [iconEmbed], components: [row] });
  },
};