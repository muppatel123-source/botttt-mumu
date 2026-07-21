const { EmbedBuilder, AuditLogEvent } = require('discord.js');

module.exports = {
  name: 'cases',
  aliases: ['logs', 'history'],
  description: 'Shows the most recent moderation actions in the server',
  async execute(message, args) {
    if (!message.member.permissions.has('ViewAuditLog')) {
      return message.reply("<:no_access:1486743854794281092> **Access Denied:** You need `View Audit Log` permission.");
    }

    try {
      // 2. Fetch the last 10 moderation entries
      const auditLogs = await message.guild.fetchAuditLogs({ limit: 10 });
      
      const logList = auditLogs.entries
        .filter(entry => [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberUpdate].includes(entry.action))
        .map(entry => {
          let type = 'Action';
          if (entry.action === AuditLogEvent.MemberKick) type = '<:KICK:1486744635673018378> Kick';
          if (entry.action === AuditLogEvent.MemberBanAdd) type = '<:ban:1486742620993622107> Ban';
          if (entry.action === AuditLogEvent.MemberUpdate && entry.changes.some(c => c.key === 'communication_disabled_until')) type = '<:muted:1486744885506736219> Mute';

          return `**${type}** | ${entry.target.tag}\n└ By: ${entry.executor.tag} | Reason: \`${entry.reason || 'None'}\``;
        }).join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<:moderation:1486732346769281096> Recent Moderation Actions')
        .setDescription(logList || "No recent moderation actions found in logs.")
        .setFooter({ text: 'Note: Mutes are shown as "Member Updates" in Discord logs.' })
        .setTimestamp();

      message.reply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      message.reply("<a:error:1486745155775234309> **Error:** I couldn't fetch the audit logs. Check my permissions!");
    }
  },
};