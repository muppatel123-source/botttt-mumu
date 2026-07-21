const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'testgreetings',
  description: 'Previews the high-tier Welcome, Leave, and Boost designs.',
  cooldown: 10,
  userPermissions: [PermissionFlagsBits.Administrator],
  data: new SlashCommandBuilder()
    .setName('testgreetings')
    .setDescription('Previews the high-tier Welcome, Leave, and Boost designs.'),

  async execute(message) {
    await this.sendPreviews(message, message.member, false);
  },

  async slashExecute(interaction) {
    // We use a regular reply for the first line, then follow up with the rest
    await interaction.reply("━━━━━━━━━━━━━━━");
    await this.sendPreviews(interaction, interaction.member, true);
  },

  async sendPreviews(input, member, isSlash) {
    const guild = input.guild;

    // 1. Welcome Preview (Your exact design)
    const welcomeEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('✨ A New Member Has Arrived!')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setDescription(`Welcome to **${guild.name}**, ${member}!\n\n💬 Be sure to check the rules and enjoy your stay.\n\n📊 **Member Count:** \`#${guild.memberCount}\` \n📅 **Joined Discord:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`)
        .setFooter({ text: `User ID: ${member.id}` })
        .setTimestamp();

    // 2. Leave Preview (Your exact design)
    const leaveEmbed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setAuthor({ name: `Member Departed`, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
        .setDescription(`**${member.user.tag}** has left the server. \n\n📉 We are now at **${guild.memberCount}** members.`)
        .setTimestamp();

    // 3. Boost Preview (Your exact design)
    const boostEmbed = new EmbedBuilder()
        .setColor(0xFF73FA)
        .setTitle(`🚀 Server Power-Up!`)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setDescription(`✨ **HUGE THANKS TO ${member}!**\n\nYou just boosted the server! Your support helps us unlock better audio quality and more emoji slots!`)
        .addFields(
            { name: '💎 Current Tier', value: `Level ${guild.premiumTier}`, inline: true },
            { name: '💖 Total Boosts', value: `${guild.premiumSubscriptionCount}`, inline: true }
        )
        .setTimestamp();

    if (isSlash) {
        // Slash follow-ups to maintain the multi-message look
        await input.followUp({ content: `🎊 **Welcome Ping Example:** ${member}`, embeds: [welcomeEmbed] });
        await input.followUp({ embeds: [leaveEmbed] });
        await input.followUp({ content: `🎊 **Boost Ping Example:** ${member}`, embeds: [boostEmbed] });
        await input.followUp("━━━━━━━━━━━━━━━");
    } else {
        await input.channel.send("━━━━━━━━━━━━━━━");
        await input.channel.send({ content: `🎊 **Welcome Ping Example:** ${member}`, embeds: [welcomeEmbed] });
        await input.channel.send({ embeds: [leaveEmbed] });
        await input.channel.send({ content: `🎊 **Boost Ping Example:** ${member}`, embeds: [boostEmbed] });
        await input.channel.send("━━━━━━━━━━━━━━━");
    }
  }
};