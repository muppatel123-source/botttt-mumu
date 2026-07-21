const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'serverinfo',
  aliases: ['si', 'server'],
  description: 'Displays detailed statistics about this server',
  async execute(message) {
    const { guild } = message;

    // 1. Force fetch all members to fix the "1 bot" cache issue
    // This ensures Mumu sees every bot and human in the server
    const allMembers = await guild.members.fetch();
    const owner = await guild.fetchOwner();
    
    const totalMembers = guild.memberCount;
    const botCount = allMembers.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;
    const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

    // 2. Build the Clean "Eye Candy" Embed
    const siEmbed = new EmbedBuilder()
      .setColor(0xFEBE10) // Madrid Gold
      .setTitle(`<:MW_Guild:1486791917856624763> ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: true, size: 1024 }))
      .addFields(
        { name: '<a:crown_crown:1486792087054712942> Owner', value: `${owner.user.tag}`, inline: true },
        { name: '<:Calender:1486728196475846656> Created', value: `<t:${createdTimestamp}:D>`, inline: true },
        { name: '<:ID:1486736651886788819> Server ID', value: `\`${guild.id}\``, inline: true },
        
        { name: '<:Members:1486737130062614600> Members', value: `Total: **${totalMembers}**\nHumans: **${humanCount}**\nBots: **${botCount}**`, inline: true },
        { name: '<:folder:1486792625410543760> Channels', value: `Total: **${guild.channels.cache.size}**\nRoles: **${guild.roles.cache.size}**`, inline: true },
        { name: '<:features:1486794046428020852> Features', value: `Emojis: **${guild.emojis.cache.size}**\nBoosts: **${guild.premiumSubscriptionCount}**`, inline: true }
      )
      .setFooter({ 
        text: `Requested by ${message.author.username}`, 
        iconURL: message.author.displayAvatarURL({ dynamic: true }) 
      })
      .setTimestamp();

    // 3. Safe Button Logic (Only if Icon exists)
    const components = [];
    const iconURL = guild.iconURL({ dynamic: true, size: 4096 });

    if (iconURL) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Download Icon')
          .setStyle(ButtonStyle.Link)
          .setURL(iconURL)
          .setEmoji('<:download:1486736181206061106>')
      );
      components.push(row);
    }

    // 4. Send the Reply
    await message.reply({ embeds: [siEmbed], components: components });
  },
};