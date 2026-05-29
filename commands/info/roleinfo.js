const { EmbedBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  name: 'roleinfo',
  aliases: ['ri', 'role'],
  description: 'Displays detailed information about a specific role',
  async execute(message, args) {
    // 1. Find the role (Mention, ID, or Name)
    const query = args.join(' ');
    if (!query) return message.reply("<a:CAUTION:1486728415015993477> **Usage:** `.roleinfo @role` or `.roleinfo roleID`.");

    const role = message.mentions.roles.first() || 
                 message.guild.roles.cache.get(query) || 
                 message.guild.roles.cache.find(r => r.name.toLowerCase().includes(query.toLowerCase()));

    if (!role) return message.reply("<a:search:1486727908625092639> I couldn't find that role. Check the ID or name!");

    // 2. Format Permissions (Only showing the important ones to avoid a wall of text)
    const keyPermissions = [
      'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 
      'KickMembers', 'BanMembers', 'MentionEveryone', 'ModerateMembers'
    ];
    
    const hasPermissions = role.permissions.toArray().filter(p => keyPermissions.includes(p));
    const permissionsList = hasPermissions.length > 0 ? hasPermissions.map(p => `\`${p}\``).join(', ') : 'None (Standard Member)';

    // 3. Create the Embed
    const roleEmbed = new EmbedBuilder()
      .setColor(role.color || 0xFEBE10) // Matches role color or Madrid Gold
      .setTitle(`<:Info:1486732443888259154> Role Information: ${role.name}`)
      .addFields(
        { name: '<:ID:1486736651886788819> ID', value: `\`${role.id}\``, inline: true },
        { name: '<:colors:1486737040740581537> Color Hex', value: `\`${role.hexColor.toUpperCase()}\``, inline: true },
        { name: '<:Calender:1486728196475846656> Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:f>\n(<t:${Math.floor(role.createdTimestamp / 1000)}:R>)`, inline: false },
        { name: '<:Members:1486737130062614600> Members', value: `**${role.members.size}** total`, inline: true },
        { name: '<:position:1486737264053588008> Position', value: `${role.position} (from bottom)`, inline: true },
        { name: '🔒 Hoisted?', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: '<:permissions:1486737850207703161> Key Permissions', value: permissionsList, inline: false }
      )
      .setFooter({ text: `Mentionable: ${role.mentionable ? 'Yes' : 'No'}` })
      .setTimestamp();

    message.reply({ embeds: [roleEmbed] });
  },
};