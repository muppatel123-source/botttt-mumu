const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'translate',
  aliases: ['tr', 'lang'],
  description: 'Translates text. Usage: .tr [language] [text] (e.g. .tr hindi Hello)',
  async execute(message, args) {
    if (args.length < 1) return message.reply("❗ **Usage:** `.tr hindi Hello` or `.tr gujarati how are you`.");

    // 1. Language Mapping Object
    const langMap = {
      'hindi': 'hi',
      'gujarati': 'gu',
      'spanish': 'es',
      'french': 'fr',
      'japanese': 'ja',
      'german': 'de',
      'italian': 'it',
      'russian': 'ru',
      'chinese': 'zh-CN',
      'korean': 'ko',
      'arabic': 'ar',
      'portuguese': 'pt',
      'english': 'en'
    };

    let targetLang = 'en'; // Default
    let textToTranslate = '';
    
    const firstArg = args[0].toLowerCase();

    // 2. Logic: Check if the first word is a full language name or a 2-letter code
    if (langMap[firstArg]) {
      targetLang = langMap[firstArg];
      textToTranslate = args.slice(1).join(' ');
    } else if (firstArg.length === 2) {
      targetLang = firstArg;
      textToTranslate = args.slice(1).join(' ');
    } else {
      // If no language detected, translate the whole thing to English
      textToTranslate = args.join(' ');
    }

    if (!textToTranslate) return message.reply("❗ Please provide the text you want to translate.");

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      
      const translatedText = data[0].map(item => item[0]).join('');
      const detectedLang = data[2];

      const trEmbed = new EmbedBuilder()
        .setColor(0xFEBE10)
        .setTitle('<:translate:1486795105376669736> Universal Translator')
        .addFields(
          { name: '📥 Input', value: `\`\`\`${textToTranslate}\`\`\`` },
          { name: `📤 Translated (${targetLang.toUpperCase()})`, value: `**${translatedText}**` }
        )
        .setFooter({ text: `From: ${detectedLang.toUpperCase()} ➡️ To: ${targetLang.toUpperCase()}` });

      message.reply({ embeds: [trEmbed] });

    } catch (err) {
      console.error(err);
      message.reply("<a:Cross_:1486728686005649650> **Error:** Failed to reach the translation service.");
    }
  },
};