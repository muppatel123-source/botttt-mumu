const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'banlist',
  aliases: ['bans', 'showbans'],
  description: 'Displays a list of all users currently banned from the server',
  async execute(message, args) {
    // 1. Permission Check
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply("<:no_access:1486743854794281092> **Access Denied:** You need `Ban Members` permission to view the ban list.");
    }

    try {
      // 2. Fetch all bans from the server
      const bans = await message.guild.bans.fetch();

      if (bans.size === 0) {
        return message.reply("<:tick:1486733833419358339> **Clean Slate:** There are currently no banned users in this server.");
      }

      // 3. Format the list (Showing top 10 to keep the embed clean)
      const bannedUsers = bans.map(ban => `**${ban.user.tag}**\n└ ID: \`${ban.user.id}\` | Reason: \`${ban.reason || 'No reason provided'}\``)
        .slice(0, 10)
        .join('\n\n');

      const banListEmbed = new EmbedBuilder()
        .setColor(0xFF0000) // Red for Bans
        .setTitle(`🔨 Ban List for ${message.guild.name}`)
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setDescription(bannedUsers)
        .addFields({ name: '<:stats:1486744163641725068> Statistics', value: `Total Bans: \`${bans.size}\`` })
        .setFooter({ text: bans.size > 10 ? `Showing first 10 bans...` : `Full list displayed` })
        .setTimestamp();

      message.reply({ embeds: [banListEmbed] });

    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> **System Error:** I couldn't fetch the ban list. Make sure I have the `Ban Members` permission!");
    }
  },
};