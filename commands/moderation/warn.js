const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'warn',
  description: 'Issues a formal warning to a member.',
  usage: '.warn <@user/ID> [reason]',
  examples: ['.warn @User123 Toxicity', '.warn 1234567890 Caps spam'],
  async execute(message, args) {
    const OWNER_ID = process.env.OWNER_ID;
    const isOwner = message.author.id === OWNER_ID;

    // 👑 1. THE DICTATOR OVERRIDE (Top Priority)
    // If NOT owner, check for ManageMessages permission
    if (!isOwner && !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply("<a:Cross_:1486728686005649650> You don't have permission to use this command.");
    }

    const mention = message.mentions.members.find(m => {
        return message.reference ? m.id !== message.mentions.repliedUser?.id : true;
    });

    const target = mention || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);

    // Help Embed if no target
    if (!target) {
      const helpEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<a:error:1486745155775234309> Command: Warn')
        .setDescription('Issues a warning to a member.')
        .addFields(
          { name: '<:notessssss:1486742759606976644> Usage', value: `\`${this.usage}\``, inline: true },
          { name: '<:Example:1486743197127544974> Example', value: `\`${this.examples.join('\n')}\``, inline: true }
        )
        .setFooter({ text: `Requested by ${message.author.username}` });

      return message.reply({ embeds: [helpEmbed] });
    }

    // 🛡️ 2. ROLE HIERARCHY CHECK (Bypassed by Dictator)
    if (!isOwner) {
        if (target.roles.highest.position >= message.member.roles.highest.position) {
            return message.reply("<a:Cross_:1486728686005649650> **Access Denied.** You cannot warn someone with an equal or higher role!");
        }
    }

    // Basic protections
    if (target.id === message.author.id) {
      return message.reply("<:alerts:1486802066767610066> Don't be so hard on yourself! You can't warn yourself.");
    }

    if (target.id === message.client.user.id) {
      return message.reply("<:alerts:1486802066767610066> Nice try, but you can't use me against myself!");
    }

    // Target protections (Dictator is untouchable)
    if (target.id === OWNER_ID) {
      return message.reply("<:alerts:1486802066767610066> **Nice try!** You are attempting to punish the **Dictator**. Access denied.");
    }

    if (target.id === process.env.ALT_ID) {
      return message.reply("<:alerts:1486802066767610066> **Got You!** You thought you can punish the **Dictator**'s alt. Access denied.");
    }

    if (target.user.bot) return message.reply("<a:Cross_:1486728686005649650> You cannot warn bots.");

    const reason = args.slice(1).join(' ') || 'No reason provided';

    // --- ENMAP SAVING LOGIC ---
    const key = `${message.guild.id}-${target.id}`;
    
    message.client.warnings.ensure(key, {
      user: target.user.tag,
      warnings: [],
      count: 0
    });

    const warnData = {
      moderator: message.author.tag,
      reason: reason,
      timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };

    message.client.warnings.push(key, warnData, "warnings");
    message.client.warnings.inc(key, "count");
    
    const currentWarns = message.client.warnings.get(key, "count");

    try {
      await target.send(`<a:error:1486745155775234309> You have received a **warning** in **${message.guild.name}**\n**Reason:** ${reason}`);
    } catch (err) {
      console.log("Could not DM user.");
    }

    message.reply(`<:tick:1486733833419358339> **${target.user.tag}** has been warned. | **Total Warns: ${currentWarns}** | Reason: ${reason}`);
  },
};