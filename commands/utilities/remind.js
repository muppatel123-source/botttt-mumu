const ms = require('ms'); // Ensure you have run: npm install ms

module.exports = {
  name: 'remind',
  aliases: ['timer', 'alarm'],
  description: 'Sets a study timer (e.g., .timer 25m Physics Revision)',
  async execute(message, args) {
    const timeInput = args[0];
    const reason = args.slice(1).join(' ') || 'Study Session';

    if (!timeInput) return message.reply("<a:CAUTION:1486728415015993477> **Usage:** `.timer [time] [reason]` (e.g., `.timer 60m Math Paper`)");

    const duration = ms(timeInput);
    if (!duration || duration < 1000) return message.reply("❗ **Invalid Time:** Use `10s`, `5m`, or `1h`.");

    message.reply(`<:target:1486791051577393272> **Timer Set:** I will remind you about **${reason}** in \`${timeInput}\`. Go focus!`);

    setTimeout(() => {
      message.reply(`<a:timeup:1486791228162052240> **TIME IS UP, <@${message.author.id}>!**\nYour timer for **${reason}** has finished.`);
    }, duration);
  },
};