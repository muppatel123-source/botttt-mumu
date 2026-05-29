const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'banner',
  aliases: ['ubanner', 'sbanner', 'guildbanner'],
  description: 'Displays the banner of a user or the server',
  async execute(message, args) {
    const query = args.join(' ').toLowerCase();

    // 1. Check if the user wants the SERVER banner
    if (query === 'server' || query === 'guild' || query === 's') {
      const bannerURL = message.guild.bannerURL({ size: 1024, dynamic: true });
      if (!bannerURL) return message.reply("❌ This server doesn't have a banner set (needs Level 2 Boost).");

      return sendBanner(message, `Server Banner: ${message.guild.name}`, bannerURL);
    }

    // 2. Otherwise, look for a USER banner
    let targetUser = message.mentions.users.first() || 
                     await message.client.users.fetch(args[0]).catch(() => null);

    if (!targetUser && query) {
      const member = message.guild.members.cache.find(m => 
        m.user.username.toLowerCase().includes(query) || 
        (m.nickname && m.nickname.toLowerCase().includes(query))
      );
      if (member) targetUser = member.user;
    }

    if (!targetUser) targetUser = message.author;

    // 3. IMPORTANT: You MUST fetch the user fully to see their banner
    const fullUser = await targetUser.fetch(true); 
    const bannerURL = fullUser.bannerURL({ size: 1024, dynamic: true });

    if (!bannerURL) {
      return message.reply(`<:closed:1486734116891394208> **${fullUser.username}** does not have a profile banner set.`);
    }

    sendBanner(message, `${fullUser.tag}'s Banner`, bannerURL);
  },
};

// Helper function to keep the code clean
function sendBanner(message, title, url) {
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  
  const embed = new EmbedBuilder()
    .setColor(0xFEBE10)
    .setTitle(`<:banner:1486779544710152264> ${title}`)
    .setImage(url)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Download Banner')
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setEmoji('<:download:1486736181206061106>')
  );

  message.reply({ embeds: [embed], components: [row] });
}