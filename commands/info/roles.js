// commands/roles.js
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'roles',
  aliases: ['listroles', 'myroles', 'r'],
  description: 'Lists all roles of a member by mention, ID, or name',
  
  execute(message, args) {
    // --- PASTE THE SEARCH LOGIC HERE ---
    const query = args.join(' ').toLowerCase();
    let targetMember = message.mentions.members.first();

    if (!targetMember && query) {
      // 1. Try to find by ID
      targetMember = message.guild.members.cache.get(query);

      // 2. If not found by ID, try to find by Username or Nickname
      if (!targetMember) {
        targetMember = message.guild.members.cache.find(m => 
          m.user.username.toLowerCase().includes(query) || 
          (m.nickname && m.nickname.toLowerCase().includes(query))
        );
      }
    }

    // 3. Fallback to the person who sent the message
    if (!targetMember) targetMember = message.member;
    // --- END OF SEARCH LOGIC ---

    // Now we get the roles of the targetMember we found
    const roles = targetMember.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => role.toString())
      .join(', ') || 'No roles';

    const rolesEmbed = new EmbedBuilder()
      .setColor(0xFEBE10) // Real Madrid Gold
      .setTitle(`${targetMember.user.username}'s Roles`)
      .setThumbnail(targetMember.displayAvatarURL({ dynamic: true }))
      .addFields({ name: 'Roles List', value: roles })
      .setFooter({ text: `Requested by ${message.author.tag}` })
      .setTimestamp();

    message.reply({ embeds: [rolesEmbed] });
  },
};