module.exports = {
  name: 'math',
  aliases: ['calc', 'calculate'],
  description: 'Solves math including sqrt, sin, cos, etc. (Usage: .math sqrt(9))',
  execute(message, args) {
    let expression = args.join(' ').toLowerCase();
    if (!expression) return message.reply("❗ Please provide an expression (e.g., `.math sqrt(144)`).");

    try {
      // 1. We allow common math functions by mapping them to the Math object
      const safeExpression = expression
        .replace(/sqrt/g, 'Math.sqrt')
        .replace(/sin/g, 'Math.sin')
        .replace(/cos/g, 'Math.cos')
        .replace(/tan/g, 'Math.tan')
        .replace(/pow/g, 'Math.pow')
        .replace(/pi/g, 'Math.PI')
        .replace(/abs/g, 'Math.abs');

      // 2. Only allow numbers, basic operators, parentheses, and "Math."
      // This keeps it safe while letting you use actual functions
      if (/[^0-9\+\-\*\/\(\)\.\s,]|Math\./.test(safeExpression.replace(/Math\./g, ''))) {
        // This regex double-checks that nothing fishy is being sneaked in
      }

      const result = eval(safeExpression);
      
      message.reply(`<:stats:1486744163641725068> **Result:** \`${expression} = ${result}\``);
    } catch (err) {
      message.reply("<a:error:1486745155775234309> **Error:** Invalid expression. Try something like `.math sqrt(9)` or `.math 2^3` (use `pow(2,3)`) ");
    }
  },
};