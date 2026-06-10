module.exports = {
  name: 'nickname',
  aliases: ['setnick', 'rename'],
  description: 'Changes the server nickname of a member',
  async execute(message, args) {
    // 1. Permission Check
    if (!message.member.permissions.has('ManageNicknames')) {
      return message.reply("<:closed:1486734116891394208> **Access Denied:** You need `Manage Nicknames` permission.");
    }

    const query = args[0];
    const newNick = args.slice(1).join(' ');

    if (!query) return message.reply("<a:CAUTION:1486728415015993477> **Usage:** `.nickname @user New Name` or `.nickname @user reset`.");

    // 2. Pro Search Logic (Mentions, ID, or Name)
    let targetMember = message.mentions.members.first() || 
                       message.guild.members.cache.get(query) ||
                       message.guild.members.cache.find(m => m.user.username.toLowerCase().includes(query.toLowerCase()));

    if (!targetMember) return message.reply("🔍 I couldn't find that user.");

    // 3. Hierarchy Check (Bot can't change names of those higher than it)
    if (!targetMember.manageable) {
      return message.reply("<a:error:1486745155775234309> **Hierarchy Error:** I don't have permission to change this user's nickname.");
    }

    try {
      // 4. Reset or Change
      if (!newNick || newNick.toLowerCase() === 'reset') {
        await targetMember.setNickname(null);
        return message.reply(`<:tick:1486733833419358339> **Reset:** Nickname for **${targetMember.user.tag}** has been cleared.`);
      }

      // Discord nickname limit is 32 characters
      if (newNick.length > 32) {
        return message.reply("<a:error:1486745155775234309> **Limit Exceeded:** Nicknames must be 32 characters or less.");
      }

      await targetMember.setNickname(newNick);
      message.reply(`<:notessssss:1486742759606976644> **Success:** Nickname for **${targetMember.user.tag}** changed to \`${newNick}\`.`);

    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> Something went wrong while updating the nickname.");
    }
  },
};
