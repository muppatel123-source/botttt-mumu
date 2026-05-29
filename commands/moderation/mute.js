const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ms = require('ms'); 

module.exports = {
  name: 'mute',
  aliases: ['timeout', 'stfu'],
  description: 'Temporarily silences a member.',
  usage: '.mute <@user/ID> <time> [reason]',
  examples: ['.mute @User123 10m Spamming', '.mute @User123 1 hour Toxic'],
  async execute(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("<a:Cross_:1486728686005649650> You don't have permission to use this command.");
    }

    // 1. Strict Target Detection (Explicit only, ignores auto-reply mentions)
    const target = message.mentions.members.filter(m => message.content.includes(m.id)).first() || 
                 (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);

    // 2. Smart Duration Parsing
    // This checks if args[2] is a time unit (like 'minutes') to handle "1 minute"
    let durationInput = args[1];
    let reasonIndex = 2;

    if (args[2] && /^(second|seconds|minute|minutes|hour|hours|day|days|s|m|h|d)$/i.test(args[2])) {
        durationInput = `${args[1]} ${args[2]}`;
        reasonIndex = 3;
    }

    const msTime = durationInput ? ms(durationInput) : null;

    // 3. Info Embed (If target or time is missing/invalid)
    if (!target || !msTime) {
      const helpEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<:muted:1486744885506736219> Command: Mute')
        .setDescription('Puts a member in timeout for a specified duration.')
        .addFields(
          { name: '<:notessssss:1486742759606976644> Usage', value: `\`${this.usage}\``, inline: true },
          { name: '<:Example:1486743197127544974> Example', value: `\`${this.examples.join('\n')}\``, inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.username}` });

      return message.reply({ embeds: [helpEmbed] });
    }

    // Max 28 days check (Discord limit)
    if (msTime > 2419200000) { 
        return message.reply("<a:Cross_:1486728686005649650> Maximum mute duration is 28 days.");
    }

    // --- Protections ---
    if (target.id === message.author.id) return message.reply("<:alerts:1486802066767610066> You can't mute yourself.");
    if (target.id === message.client.user.id) return message.reply("<:alerts:1486802066767610066> Nice try!");
    if (target.id === process.env.OWNER_ID || target.id === process.env.ALT_ID) {
        return message.reply("<:alerts:1486802066767610066> You cannot punish the **Dictator**.");
    }

    if (message.member.roles.highest.position <= target.roles.highest.position && message.guild.ownerId !== message.author.id) {
        return message.reply("<a:Cross_:1486728686005649650> **Hierarchy Error.**");
    }

    const reason = args.slice(reasonIndex).join(' ') || 'No reason provided';

    // 4. Execution
    try {
      await target.send(`<:muted:1486744885506736219> You have been **muted** in **${message.guild.name}** for **${durationInput}**\n**Reason:** ${reason}`).catch(() => null);
      
      await target.timeout(msTime, reason);
      message.reply(`<:tick:1486733833419358339> **${target.user.tag}** has been muted for **${durationInput}**. | Reason: ${reason}`);
    } catch (error) {
      console.error(error);
      message.reply("<a:Cross_:1486728686005649650> I cannot mute this user.");
    }
  },
};