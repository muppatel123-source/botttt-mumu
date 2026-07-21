const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'softban',
  aliases: ['sb', 'clearkick'],
  description: 'Bans and immediately unbans a user to clear their messages.',
  async execute(message, args) {
    // 1. Permission Check
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply("<a:error:1486745155775234309> **Access Denied:** You need `Ban Members` permission.");
    }

    const query = args[0];
    const reason = args.slice(1).join(' ') || 'No reason specified (Softban)';

    if (!query) return message.reply("<a:CAUTION:1486728415015993477> **Usage:** `.softban @user [reason]`");

    // 2. Find the Member
    const targetMember = message.mentions.members.first() || 
                         await message.guild.members.fetch(query).catch(() => null);

    if (!targetMember) return message.reply("<a:search:1486727908625092639> I couldn't find that user in this server.");

    // 3. Hierarchy Check (Can the bot actually ban them?)
    if (!targetMember.bannable) {
      return message.reply("<a:error:1486745155775234309> **Hierarchy Error:** I cannot softban this user (they might have a higher role than me).");
    }

    try {
      // 4. THE SOFTBAN LOGIC
      // Step A: Ban the user (deleteMessagesSeconds: 604800 is 7 days)
      await targetMember.ban({ deleteMessagesSeconds: 604800, reason: `Softban: ${reason}` });

      // Step B: Immediately Unban
      await message.guild.members.unban(targetMember.id, 'Softban complete (message cleanup)');

      // 5. Success Embed
      const sbEmbed = new EmbedBuilder()
        .setColor(0xFFA500) // Orange for Softban
        .setTitle('<:bans:1486770624973111607> Softban Executed')
        .addFields(
          { name: '<:user:1486770775238377554> User', value: `**${targetMember.user.tag}**`, inline: true },
          { name: '<:moderation:1486732346769281096> Moderator', value: `**${message.author.tag}**`, inline: true },
          { name: '<a:cleaned:1486767890152689925> Action', value: 'Kicked & Messages Cleared (7 Days)', inline: false },
          { name: '<:notessssss:1486742759606976644>  Reason', value: `\`${reason}\``, inline: false }
        )
        .setTimestamp();

      message.reply({ embeds: [sbEmbed] });

      // Optional: Log it to your modlogs if you set them up
    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> **Error:** Something went wrong during the softban process.");
    }
  },
};