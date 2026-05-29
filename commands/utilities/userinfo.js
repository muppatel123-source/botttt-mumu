const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'userinfo',
  aliases: ['whois', 'ui', 'user'],
  description: 'Displays deep information about a member',
  execute(message, args) {
    const query = args.join(' ').toLowerCase();
    
    // 1. Start with the mention
    let targetMember = message.mentions.members.first();

    // 2. If no mention, search by ID or Name
    if (!targetMember && query) {
      targetMember = message.guild.members.cache.get(query) || 
                     message.guild.members.cache.find(m => 
                       m.user.username.toLowerCase() === query || 
                       (m.nickname && m.nickname.toLowerCase() === query)
                     ) ||
                     // Fallback to "includes" if an exact match isn't found
                     message.guild.members.cache.find(m => 
                       m.user.username.toLowerCase().includes(query)
                     );
    }

    // 3. If still nothing, or if no args were provided, use the person who sent the message
    if (!targetMember || !args.length) targetMember = message.member;

    const user = targetMember.user;
    
    // Permissions check for status label
    const permissions = targetMember.permissions.toArray();
    let status = 'Member';
    if (permissions.includes('Administrator')) status = '<a:crown_crown:1486792087054712942> Administrator';
    else if (permissions.includes('ManageMessages') || permissions.includes('KickMembers')) status = '<:moderation:1486732346769281096> Moderator';

    const uiEmbed = new EmbedBuilder()
      .setColor(0xFEBE10)
      .setAuthor({ name: `User Profile: ${user.tag}`, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
      .addFields(
        { name: '<:ID:1486736651886788819> Identification', value: `**User ID:** \`${user.id}\`\n**Status:** ${status}`, inline: false },
        { name: '<:Calender:1486728196475846656> Dates', value: `**Joined Discord:** <t:${Math.floor(user.createdTimestamp / 1000)}:f>\n**Joined Server:** <t:${Math.floor(targetMember.joinedTimestamp / 1000)}:f>`, inline: false },
        { name: '<a:Timer:1486795860699250698> Relative Time', value: `**Account Age:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n**Stay Duration:** <t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: false },
        { name: '<:roles:1486795993038065697> Roles', value: `**Top Role:** ${targetMember.roles.highest}\n**Total Roles:** ${targetMember.roles.cache.size - 1}`, inline: true },
        { name: '<:bots:1486796104044380190> Bot?', value: user.bot ? 'Yes' : 'No', inline: true }
      )
      .setFooter({ text: `Requested by ${message.author.username}` })
      .setTimestamp();

    message.reply({ embeds: [uiEmbed] });
  },
};