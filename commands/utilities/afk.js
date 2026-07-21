module.exports = {
  name: 'afk',
  description: 'Sets your status as AFK and updates your nickname',
  async execute(message, args) {
    const reason = args.join(' ') || 'AFK';
    const oldNickname = message.member.nickname || message.member.user.username;

    // --- ENMAP SAVING LOGIC ---
    // We now save 'oldNickname' and 'time' to match the index.js logic
    message.client.afk.set(message.author.id, {
      reason: reason,
      time: Date.now(),
      oldNickname: oldNickname 
    });

    message.reply(`<:tick:1486733833419358339> AFK set: **${reason}**.`);

    // Change Nickname to [AFK] Name
    if (message.member.manageable && !message.member.displayName.startsWith('[AFK]')) {
      // Ensure we don't exceed Discord's 32 character limit
      const newNick = `[AFK] ${message.member.displayName}`.slice(0, 32);
      await message.member.setNickname(newNick).catch(() => null);
    } else {
      console.log(`<a:error:1486745155775234309> Hierarchy Skip: Cannot change nickname for ${message.author.tag}`);
    }
  },
};