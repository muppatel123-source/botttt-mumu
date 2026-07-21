const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'ping',
  description: 'Checks the bot\'s connection speed',
  
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Checks the bot\'s connection speed'),
  
  // ⌨️ For Prefix (.)
  async execute(message) {
    const msg = await message.reply('🏓 Pinging...');
    const latency = msg.createdTimestamp - message.createdTimestamp;
    const choices = ['Is that all you got?', 'Fast as Mbappé!', 'Solid connection.', 'A bit laggy today...'];
    const phrase = choices[Math.floor(Math.random() * choices.length)];

    msg.edit(`🏓 **Pong!**\n**Latency:** \`${latency}ms\`\n**API Latency:** \`${message.client.ws.ping}ms\`\n\n*${phrase}*`);
  },

  // 🚀 For Slash (/)
  async slashExecute(interaction) {
    // Slash commands use interaction.reply, not message.reply
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const choices = ['Is that all you got?', 'Fast as Mbappé!', 'Solid connection.', 'A bit laggy today...'];
    const phrase = choices[Math.floor(Math.random() * choices.length)];

    await interaction.editReply(`🏓 **Pong!**\n**Latency:** \`${latency}ms\`\n**API Latency:** \`${interaction.client.ws.ping}ms\`\n\n*${phrase}*`);
  }
};