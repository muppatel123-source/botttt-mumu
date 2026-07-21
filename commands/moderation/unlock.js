module.exports = {
  name: 'unlock',
  aliases: ['open'],
  description: 'Unlocks a specific channel (Mention, ID, or current channel)',
  async execute(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
      return message.reply("<:closed:1486734116891394208> **Access Denied:** You need `Manage Channels` permission.");
    }

    const targetChannel = message.mentions.channels.first() || 
                          message.guild.channels.cache.get(args[0]) || 
                          message.channel;

    if (!targetChannel.isTextBased()) {
      return message.reply("❗ **Error:** I can only unlock text-based channels.");
    }

    try {
      // 4. Restore Permissions (Setting to null lets the category/server defaults take over)
      await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: null,
        AddReactions: null
      });

      message.reply(`<:unlockesjwhhsbws:1486773671635849288>  **Channel Unlocked:** Members can now type in ${targetChannel} again.`);
    } catch (err) {
      console.error(err);
      message.reply("<a:error:1486745155775234309> **System Error:** I couldn't unlock that channel.");
    }
  },
};