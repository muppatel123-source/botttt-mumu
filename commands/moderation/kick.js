const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'kick',
  description: 'Kicks a member from the server.',
  usage: '.kick <@user/ID> [reason]',
  examples: ['.kick @User123 Spamming', '.kick 1234567890 Breaking rules'],
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply("<a:Cross_:1486728686005649650> You don't have permission to use this command.");
    }

    // THE FIX: Filter out the person you are replying to
    const mention = message.mentions.members.find(m => {
        return message.reference ? m.id !== message.mentions.repliedUser?.id : true;
    });

    const target = mention || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);

  
    if (!target) {
      const helpEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<:moderation:1486732346769281096> Command: Kick')
        .setDescription('Kicks a member from the guild.')
        .addFields(
          { name: '<:notessssss:1486742759606976644> Usage', value: `\`${this.usage}\``, inline: true },
          { name: '<:Example:1486743197127544974> Example', value: `\`${this.examples.join('\n')}\``, inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() });

      return message.reply({ embeds: [helpEmbed] });
    }
    
    if (target.id === message.author.id) {
  return message.reply("<:alerts:1486802066767610066> Why would you want to leave like this? You can't kick yourself.");
}

    if (target.id === message.client.user.id) {
  return message.reply("<:alerts:1486802066767610066> Nice try, but you can't use me against myself!");
}

  if (target.id === process.env.OWNER_ID) {
    return message.reply("<:alerts:1486802066767610066> **Nice try!** You are attempting to punish the **Dictator**. Access denied.");
}

    if (message.member.roles.highest.position <= target.roles.highest.position && message.guild.ownerId !== message.author.id) {
    return message.reply("<a:Cross_:1486728686005649650> **Hierarchy Error:** You cannot punish someone with a higher or equal role to yours!");
}

    if (target.id === process.env.ALT_ID) {
    return message.reply("<:alerts:1486802066767610066> **Got You!** You thought you can punish the **Dictator**'s alt. Access denied.");
}

    if (!target.kickable) {
      return message.reply("<a:Cross_:1486728686005649650> I cannot kick this user (Hierarchy issue).");
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      await target.send(`<:moderation:1486732346769281096> You have been **kicked** from **${message.guild.name}**\n**Reason:** ${reason}`);
    } catch (err) {
      console.log("Could not DM user.");
    }

    try {
      await target.kick(reason);
      message.reply(`<:tick:1486733833419358339> **${target.user.tag}** has been kicked. | Reason: ${reason}`);
    } catch (error) {
      message.reply("<a:Cross_:1486728686005649650> An error occurred while trying to kick this member.");
    }
  },
};