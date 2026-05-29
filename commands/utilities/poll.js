module.exports = {
  name: 'poll',
  aliases: ['vote', 'ask'],
  description: 'Creates a modern poll. Optional: -m (multi-select), -h [hours]',
  async execute(message, args) {
    const fullInput = args.join(' ');
    
    // 1. Extract everything in quotes: "Question" "Opt1" "Opt2"
    const regex = /"([^"]+)"/g;
    const matches = [];
    let match;
    while ((match = regex.exec(fullInput)) !== null) {
      matches.push(match[1]);
    }

    if (matches.length < 3) {
      return message.reply('<a:CAUTION:1486728415015993477> **Usage:** `.poll "Question" "Option 1" "Option 2" [-m] [-h hours]`');
    }

    const [question, ...options] = matches;

    // 2. Parse Optional Flags (outside the quotes)
    const isMulti = fullInput.toLowerCase().includes('-m');
    
    // Check for -h followed by a number (e.g., -h 48)
    const hourMatch = fullInput.match(/-h\s+(\d+)/);
    const durationHours = hourMatch ? parseInt(hourMatch[1]) : 24;

    // Discord limits: 10 options max, 7 days (168h) max duration
    if (options.length > 10) return message.reply('<a:error:1486745155775234309> Max 10 options allowed.');
    if (durationHours > 168) return message.reply('<a:error:1486745155775234309> Max duration is 168 hours (1 week).');

    try {
      await message.channel.send({
        poll: {
          question: { text: question },
          answers: options.map(opt => ({ text: opt })),
          allowMultiselect: isMulti, // true only if -m is present
          duration: durationHours    // defaults to 24 if -h is missing
        }
      });
      
      message.delete().catch(() => null);
      
    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> **Error:** Could not create poll. Ensure quotes are correct!");
    }
  },
};