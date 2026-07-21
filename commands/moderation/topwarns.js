const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'topwarns',
  aliases: ['warnleaderboard', 'warnlb'],
  description: 'Shows the top 10 users with the most warnings in the server.',
  async execute(message, args) {
    const guildId = message.guild.id;
    const warningsMap = message.client.warnings;
    
    // 🔍 1. Filter and Map Data
    // We convert the Enmap to an array of [key, val] pairs
    const allData = Array.from(warningsMap.entries())
      .filter(([key]) => key.startsWith(`${guildId}-`))
      .map(([key, val]) => {
        return {
          id: key.split('-')[1], // Now 'key' is definitely the string ID
          count: val.count || 0
        };
      })
      .filter(user => user.count > 0)
      .sort((a, b) => b.count - a.count);

    if (allData.length === 0) {
      return message.reply("<a:AllGood:1486751170469957702> **Clean Server!** No one has any warnings yet.");
    }

    // 2. Take top 10
    const top10 = allData.slice(0, 10);

    // 3. Build the description
    const leaderboardRows = await Promise.all(top10.map(async (data, i) => {
      const user = await message.client.users.fetch(data.id).catch(() => null);
      const tag = user ? `**${user.username}**` : `Unknown (${data.id})`;
      
      let medal = `**${i + 1}.**`;
      if (i === 0) medal = "🥇";
      else if (i === 1) medal = "🥈";
      else if (i === 2) medal = "🥉";

      return `${medal} ${tag} — \`${data.count}\` warnings`;
    }));

    const embed = new EmbedBuilder()
      .setColor(0xFEBE10)
      .setTitle(`<a:error:1486745155775234309> Warning Leaderboard: ${message.guild.name}`)
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setDescription(leaderboardRows.join('\n'))
      .setFooter({ 
        text: `Requested by ${message.author.username}`, 
        iconURL: message.author.displayAvatarURL() 
      })
      .setTimestamp();

    message.reply({ embeds: [embed] });
  },
};