const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'ban',
  description: 'Bans a member from the server.',
  usage: '.ban <@user/ID> [reason]',
  examples: ['.ban @User123 Spamming', '.ban 1234567890 Breaking rules'],
  async execute(message, args) {
    // 1. Permissions Check
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply("<a:Cross_:1486728686005649650> You don't have permission to use this command.");
    }

    // 2. Strict Target Detection
    // This ONLY looks at the text you typed, ignoring the "Replied User" auto-mention.
    const target = message.mentions.members.filter(m => message.content.includes(m.id)).first() || 
                 (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);

    // 3. If no explicit target found, show Info Embed
    if (!target) {
      const helpEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<:ban:1486742620993622107> Command: Ban')
        .setDescription('Bans a member from the guild permanently.')
        .addFields(
          { name: '<:notessssss:1486742759606976644> Usage', value: `\`${this.usage}\``, inline: true },
          { name: '<:Example:1486743197127544974> Example', value: `\`${this.examples.join('\n')}\``, inline: true }
        )
        .setFooter({ 
            text: `Requested by ${message.author.username}`, 
            iconURL: message.author.displayAvatarURL() 
        });

      return message.reply({ embeds: [helpEmbed] });
    }
    
    // --- Protection Checks ---
    if (target.id === message.author.id) {
      return message.reply("<:alerts:1486802066767610066> You can't ban yourself.");
    }

    if (target.id === message.client.user.id) {
      return message.reply("<:alerts:1486802066767610066> I can't ban myself.");
    }

    if (message.member.roles.highest.position <= target.roles.highest.position && message.guild.ownerId !== message.author.id) {
      return message.reply("<a:Cross_:1486728686005649650> **Hierarchy Error.**");
    }

    if (target.id === process.env.OWNER_ID || target.id === process.env.ALT_ID) {
      return message.reply("<:alerts:1486802066767610066> Access denied. You cannot ban the Dictator.");
    }
        
    if (!target.bannable) {
      return message.reply("<a:Cross_:1486728686005649650> I cannot ban this user.");
    }

    // 4. Execution
    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      await target.send(`<:ban:1486742620993622107> You have been **banned** from **${message.guild.name}**\n**Reason:** ${reason}`).catch(() => null);
      
      await target.ban({ reason });
      message.reply(`<:tick:1486733833419358339> **${target.user.tag}** has been banned. | Reason: ${reason}`);
    } catch (error) {
      console.error(error);
      message.reply("<a:Cross_:1486728686005649650> An error occurred.");
    }
  },
};