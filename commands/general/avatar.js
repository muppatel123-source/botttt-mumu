const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'avatar',
  aliases: ['av', 'pfp'],
  description: 'Displays the server-specific or global avatar of a user',
  async execute(message, args) {
    // 1. Find the target user
    const target = message.mentions.users.first() || 
                   message.client.users.cache.get(args[0]) || 
                   message.author;

    const member = message.guild.members.cache.get(target.id);

    // 2. Get the best possible image (Server Avatar > Global Avatar)
    const avatarURL = member?.displayAvatarURL({ size: 4096, dynamic: true }) || 
                      target.displayAvatarURL({ size: 4096, dynamic: true });

    // 3. Build the Eye Candy Embed
    const avEmbed = new EmbedBuilder()
      .setColor(0xFEBE10) // Madrid Gold
      .setAuthor({ name: `${target.tag}'s Avatar`, iconURL: avatarURL })
      .setImage(avatarURL)
      .setFooter({ 
        text: `Server: ${message.guild.name}`, 
        iconURL: message.author.displayAvatarURL({ dynamic: true }) 
      })
      .setTimestamp();

    // 4. Sleek Link Button (No collector needed!)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Download Avatar')
        .setStyle(ButtonStyle.Link) // This makes it a Link Button
        .setURL(avatarURL)
        .setEmoji('<:download:1486736181206061106>')
    );

    await message.reply({ embeds: [avEmbed], components: [row] });
  },
};