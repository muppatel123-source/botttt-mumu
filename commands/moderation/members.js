const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'members',
  aliases: ['rolemembers', 'whohas'],
  description: 'Lists all members who have a specific role',
  async execute(message, args) {
    // 1. Find the role (Mention or ID)
    const roleQuery = args[0];
    if (!roleQuery) return message.reply("❗ **Usage:** `.members @role` or `.members roleID`.");

    const role = message.mentions.roles.first() || message.guild.roles.cache.get(roleQuery);

    if (!role) return message.reply("<a:search:1486727908625092639> I couldn't find that role. Make sure the ID is correct or you mentioned it properly.");

    try {
      // 2. FETCH all members to ensure the list is 100% accurate
      // (Crucial for CS students to understand: cache vs. fetch!)
      const allMembers = await message.guild.members.fetch();
      const membersWithRole = allMembers.filter(m => m.roles.cache.has(role.id));

      if (membersWithRole.size === 0) {
        return message.reply(`<:pepesad:1486758064593047572> No one in this server has the **${role.name}** role.`);
      }

      // 3. Format the list (Limit to 20 to avoid hitting Discord's 2000 character limit)
      const memberList = membersWithRole
        .map(m => `• ${m.user.tag} (\`${m.id}\`)`)
        .slice(0, 20)
        .join('\n');

      const membersEmbed = new EmbedBuilder()
        .setColor(role.color || 0xFEBE10) // Uses the role's actual color or Madrid Gold
        .setTitle(`👥 Members with ${role.name}`)
        .setDescription(memberList)
        .addFields({ name: '<:stats:1486744163641725068> Statistics', value: `Total: \`${membersWithRole.size}\` members` })
        .setFooter({ text: membersWithRole.size > 20 ? `Showing first 20 members...` : `Full list displayed` })
        .setTimestamp();

      message.reply({ embeds: [membersEmbed] });

    } catch (err) {
      console.error(err);
      message.reply("<a:error:1486745155775234309> **Error:** I couldn't fetch the member list. Check my permissions!");
    }
  },
};