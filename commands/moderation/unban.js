module.exports = {
  name: 'unban',
  description: 'Unbans a user from the server using their ID',
  async execute(message, args) {
    if (!message.member.permissions.has('BanMembers')) {
      return message.reply("<:closed:1486734116891394208> **Access Denied:** You need `Ban Members` permission.");
    }

    const userId = args[0];
    if (!userId) return message.reply("❗ Please provide the User ID to unban.");

    try {
      await message.guild.members.unban(userId);
      message.reply(`<:unban:1486772869613752472> **Success:** User with ID \`${userId}\` has been unbanned.`);
    } catch (err) {
      message.reply("<a:error:1486745155775234309> **Error:** I couldn't find a ban for that ID or the ID is invalid.");
    }
  },
};