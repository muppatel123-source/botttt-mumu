const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'addrole',
  aliases: ['createroles', 'makeroles'],
  description: 'Creates multiple roles at once using commas and hex codes.',
  usage: '.addrole <Name> [#HEX], <Name> [#HEX]...',
  examples: ['.addrole Level 1 #FF0000, Level 2 #00FF00', '.addrole VIP, Staff #3498db, Guest'],
  async execute(message, args) {
    // 1. Permissions Check
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply("<a:Cross_:1486728686005649650> You need `Manage Roles` permissions to use this.");
    }

    const input = args.join(' ');
    if (!input) {
      const helpEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('🛠️ Command: AddRole (Bulk)')
        .setDescription('Create multiple roles by separating them with commas.')
        .addFields(
          { name: '📝 Format', value: '`.addrole Name #HEX, Name #HEX`' },
          { name: '💡 Example', value: '`.addrole Red #FF0000, Blue #0000FF, NoColor`' }
        )
        .setFooter({ text: 'Max 10 roles per command to avoid rate limits.' });

      return message.reply({ embeds: [helpEmbed] });
    }

    // 2. Split by comma and clean up
    const roleEntries = input.split(',').map(item => item.trim()).filter(item => item.length > 0);

    if (roleEntries.length > 10) {
      return message.reply("<:alerts:1486802066767610066> **Too many!** Please create a maximum of **10 roles** at a time to prevent rate limits.");
    }

    const processingMsg = await message.reply(`🔄 Creating **${roleEntries.length}** roles... please wait.`);
    const createdRoles = [];
    const failedRoles = [];

    // 3. Loop and Create
    for (const entry of roleEntries) {
      // Logic to separate name from hex (looks for # followed by 6 hex chars)
      const hexMatch = entry.match(/#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})/);
      const color = hexMatch ? hexMatch[0] : null;
      const name = color ? entry.replace(color, '').trim() : entry;

      try {
        const newRole = await message.guild.roles.create({
          name: name || 'Unnamed Role',
          color: color || 0x99AAB5, // Default Discord Grey
          reason: `Bulk created by ${message.author.tag}`
        });
        createdRoles.push(`**${newRole.name}** (${color || 'Default'})`);
      } catch (err) {
        console.error(err);
        failedRoles.push(name);
      }
    }

    // 4. Final Response
    const resultEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('<:tick:1486733833419358339> Role Creation Complete')
      .setTimestamp();

    if (createdRoles.length > 0) {
      resultEmbed.addFields({ name: '✅ Created', value: createdRoles.join('\n') });
    }
    if (failedRoles.length > 0) {
      resultEmbed.setColor(0xE74C3C);
      resultEmbed.addFields({ name: '❌ Failed', value: failedRoles.join('\n') });
    }

    await processingMsg.edit({ content: null, embeds: [resultEmbed] });
  },
};