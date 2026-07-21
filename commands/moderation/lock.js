module.exports = {
  name: 'lock',
  aliases: ['close', 'lockdown'],
  description: 'Locks a specific channel (Mention, ID, or current channel)',
  async execute(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
      return message.reply("<:no_access:1486743854794281092> **Access Denied:** You need `Manage Channels` permission.");
    }

    // 1. Find the channel (Mention, then ID, then Fallback to current channel)
    const targetChannel = message.mentions.channels.first() || 
                          message.guild.channels.cache.get(args[0]) || 
                          message.channel;

    // 2. Security Check (Prevent locking non-text channels)
    if (!targetChannel.isTextBased()) {
      return message.reply("<a:CAUTION:1486728415015993477> **Error:** I can only lock text-based channels.");
    }

    try {
      // 3. Edit Permissions for @everyone
      await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false,
        AddReactions: false // Also prevents reaction spam
      });

      message.reply(`<:lockedssss:1486756648877031528> **Channel Locked:** Members can no longer type in ${targetChannel}.`);
    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> **System Error:** I couldn't lock that channel. Check my permissions!");
    }
  },
};