const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'resetprefix',
  description: 'Resets the bot prefix to the default (.)',
  async execute(message) {
    // 1. Permissions Check - Modern v14 approach
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply("<a:Cross_:1486728686005649650> You need **Administrator** permissions to reset the prefix.");
    }

    // 2. Database Action
    // This deletes the custom entry, so it falls back to '.' in your index.js logic
    if (message.client.prefixes.has(message.guild.id)) {
        message.client.prefixes.delete(message.guild.id);
        return message.reply("<:tick:1486733833419358339> **Success!** The prefix has been reset to the default: `.`");
    } else {
        return message.reply("<a:AllGood:1486751170469957702> The prefix is already set to the default: `.`");
    }
  },
};