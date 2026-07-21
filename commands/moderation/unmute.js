const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'unmute',
  aliases: ['untimeout', 'untm'],
  description: 'Removes a timeout from a member early',
  async execute(message, args) {
    // 1. Permission Check
    if (!message.member.permissions.has('ModerateMembers')) {
      return message.reply("<:closed:1486734116891394208> **Access Denied:** You need `Moderate Members` permission to unmute users.");
    }

    const query = args.join(' ').toLowerCase();
    if (!query) return message.reply("❗ Please specify a user (Ping, ID, or Name).");

    // 2. Use our Pro Search logic
    let targetMember = message.mentions.members.first();

    if (!targetMember && query) {
      targetMember = message.guild.members.cache.get(query) || 
                     message.guild.members.cache.find(m => 
                       m.user.username.toLowerCase().includes(query) || 
                       (m.nickname && m.nickname.toLowerCase().includes(query))
                     );
    }

    if (!targetMember) return message.reply("🔍 I couldn't find that user in this server.");

    // 3. Check if they are even timed out
    if (!targetMember.communicationDisabledUntilTimestamp) {
      return message.reply("<:whatda:1486774869453705269> **Wait:** This user isn't even muted/timed out!");
    }

    // 4. Remove Timeout
    try {
      await targetMember.timeout(null);

      const unmuteEmbed = new EmbedBuilder()
        .setColor(0x00FF00) // Green for success/restoration
        .setAuthor({ name: 'User Unmuted', iconURL: targetMember.user.displayAvatarURL() })
        .setDescription(`<:tick:1486733833419358339> **${targetMember.user.tag}** can now speak again!`)
        .setFooter({ text: `Action by ${message.author.tag}` })
        .setTimestamp();

      message.channel.send({ embeds: [unmuteEmbed] });
    } catch (err) {
      console.error(err);
      message.reply("<a:error:1486745155775234309> Something went wrong while trying to unmute this user.");
    }
  },
};