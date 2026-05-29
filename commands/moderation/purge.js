module.exports = {
  name: 'purge',
  aliases: ['clear', 'delete'],
  description: 'Deletes a specific number of messages (Max 100)',
 async execute(message, args) {
    // 1. Permissions Check
    if (!message.member.permissions.has('ManageMessages')) {
      return message.reply("<a:error:1486745155775234309> **Access Denied:** You need the `Manage Messages` permission to clear chat.");
    }

    const amount = parseInt(args[0]);

    // 2. Validation
    if (isNaN(amount) || amount <= 0 || amount > 100) {
      return message.reply('<a:CAUTION:1486728415015993477> **Error:** Please specify a number between 1 and 100.');
    }

    // 3. Execution (Amount + 1 to include the command message itself)
    try {
      await message.channel.bulkDelete(amount + 1, true);
      
      // Clean, minimal confirmation message
      const successMsg = await message.channel.send(`<a:cleaned:1486767890152689925>  **Chat Cleaned:** Removed \`${amount}\` messages.`);
      
      // Auto-delete the success message after 3 seconds
      setTimeout(() => successMsg.delete().catch(() => null), 3000);
      
    } catch (err) {
      console.error(err);
      message.channel.send("<a:CAUTION:1486728415015993477> **System Error:** I can't delete messages older than 14 days due to Discord's limitations.");
    }
  },
};