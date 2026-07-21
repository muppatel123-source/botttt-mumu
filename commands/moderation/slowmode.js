module.exports = {
  name: 'slowmode',
  aliases: ['slow', 'sm', 'cooldown', 'cd'],
  description: 'Sets channel slowmode (e.g., .slowmode 5s, 10m, or 1h)',
  async execute(message, args) {
    if (!message.member.permissions.has('ManageChannels')) {
      return message.reply("<a:error:1486745155775234309> **Access Denied:** You need `Manage Channels` permission.");
    }

    if (!args[0]) return message.reply("❗ Please specify a time (e.g., `.slowmode 10s`, `.slowmode 5m`, or `.slowmode 1h`).");

    const input = args[0].toLowerCase();
    
    // Check if it's just '0' or 'off'
    if (input === '0' || input === 'off') {
      await message.channel.setRateLimitPerUser(0);
      return message.reply("<:Speed:1486769441802027160> **Slowmode Disabled:** Chat is back to normal speed.");
    }

    // Match the number and the unit (s, m, h)
    const timeMatch = input.match(/^(\d+)([smh]?)$/);
    if (!timeMatch) return message.reply("<a:CAUTION:1486728415015993477> **Invalid Format:** Please use a number followed by s, m, or h (e.g., `5m`).");

    let time = parseInt(timeMatch[1]);
    const unit = timeMatch[2] || 's'; // Default to seconds if no unit is provided

    let seconds = time;
    let readableTime = `${time} second(s)`;

    if (unit === 'm') {
      seconds = time * 60;
      readableTime = `${time} minute(s)`;
    } else if (unit === 'h') {
      seconds = time * 3600;
      readableTime = `${time} hour(s)`;
    }

    // Discord Limit: Slowmode can't exceed 6 hours (21600 seconds)
    if (seconds > 21600) {
      return message.reply("<a:error:1486745155775234309> **Limit Exceeded:** Discord slowmode cannot be longer than 6 hours.");
    }

    try {
      await message.channel.setRateLimitPerUser(seconds);
      message.reply(`<:slowmode:1486769912071458890> **Slowmode Active:** Users can now only message every \`${readableTime}\`.`);
    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> Something went wrong while updating the slowmode.");
    }
  },
};