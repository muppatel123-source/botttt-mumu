const { PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'delwarn',
  aliases: ['removewarn', 'unwarn'],
  description: 'Removes a specific warning or all warnings',
  execute(message, args) {
    // 🛡️ Permission Check (Using standard Discord.js flag)
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return message.reply("<a:Cross_:1486728686005649650> You don't have permission to use this command.");
    }

    const targetMember = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!targetMember) return message.reply("🔍 Please specify a valid user.");

    const key = `${message.guild.id}-${targetMember.id}`;

    // 1. Check if user has any warnings in Enmap
    if (!message.client.warnings.has(key) || message.client.warnings.get(key, "warnings").length === 0) {
      return message.reply("<a:AllGood:1486751170469957702> This user has no warnings.");
    }

    const option = args[1]?.toLowerCase(); // 'all' or a case number

    // 2. Clear ALL Warnings
    if (option === 'all') {
      message.client.warnings.delete(key);
      return message.reply(`<:Cleared:1486750792835928095> **Cleared:** All warnings for **${targetMember.user.tag}** have been removed.`);
    } 
    
    // 3. Delete Specific Case
    const caseNum = parseInt(option);
    const index = caseNum - 1;
    const userWarns = message.client.warnings.get(key, "warnings");

    if (isNaN(caseNum) || !userWarns[index]) {
      return message.reply("<a:CAUTION:1486728415015993477> Please provide a valid case number (e.g., `.delwarn @user 1`).");
    }
    
    // Remove the specific warning from the array
    userWarns.splice(index, 1);
    
    if (userWarns.length === 0) {
      // If no warns left, just delete the key
      message.client.warnings.delete(key);
    } else {
      // Update the warnings array and the count
      message.client.warnings.set(key, userWarns, "warnings");
      message.client.warnings.set(key, userWarns.length, "count");
    }
    
    message.reply(`<:tick:1486733833419358339> **Removed:** Case \`${caseNum}\` for **${targetMember.user.tag}** has been deleted.`);
  },
};