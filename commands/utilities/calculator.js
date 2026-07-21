const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
  name: 'calculator',
  aliases: ['calc'],
  description: 'Pro Scientific calculator with State Management and Algebraic support',
  async execute(message) {
    let data = ""; 
    let isResult = false; 

    const getButtons = (disabled = false) => {
      const rows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('calc_(').setLabel('(').setStyle(1),
          new ButtonBuilder().setCustomId('calc_)').setLabel(')').setStyle(1),
          new ButtonBuilder().setCustomId('calc_^').setLabel('^').setStyle(1),
          new ButtonBuilder().setCustomId('calc_log(').setLabel('log').setStyle(1),
          new ButtonBuilder().setCustomId('calc_Quit').setLabel('Quit').setStyle(2).setEmoji('🗑️')
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('calc_7').setLabel('7').setStyle(2),
          new ButtonBuilder().setCustomId('calc_8').setLabel('8').setStyle(2),
          new ButtonBuilder().setCustomId('calc_9').setLabel('9').setStyle(2),
          new ButtonBuilder().setCustomId('calc_÷').setLabel('÷').setStyle(1),
          new ButtonBuilder().setCustomId('calc_Clear').setLabel('AC').setStyle(4)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('calc_4').setLabel('4').setStyle(2),
          new ButtonBuilder().setCustomId('calc_5').setLabel('5').setStyle(2),
          new ButtonBuilder().setCustomId('calc_6').setLabel('6').setStyle(2),
          new ButtonBuilder().setCustomId('calc_×').setLabel('×').setStyle(1),
          new ButtonBuilder().setCustomId('calc_Backspace').setLabel('⌫').setStyle(4)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('calc_1').setLabel('1').setStyle(2),
          new ButtonBuilder().setCustomId('calc_2').setLabel('2').setStyle(2),
          new ButtonBuilder().setCustomId('calc_3').setLabel('3').setStyle(2),
          new ButtonBuilder().setCustomId('calc_-').setLabel('-').setStyle(1),
          new ButtonBuilder().setCustomId('calc_%').setLabel('%').setStyle(1)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('calc_toggle').setLabel('+/-').setStyle(2),
          new ButtonBuilder().setCustomId('calc_0').setLabel('0').setStyle(2),
          new ButtonBuilder().setCustomId('calc_.').setLabel('.').setStyle(2),
          new ButtonBuilder().setCustomId('calc_+').setLabel('+').setStyle(1),
          new ButtonBuilder().setCustomId('calc_=').setLabel('=').setStyle(3)
        )
      ];

      if (disabled) {
        rows.forEach(row => row.components.forEach(btn => btn.setDisabled(true)));
      }
      return rows;
    };

    const createEmbed = (content) => {
      return new EmbedBuilder()
        .setColor(0xFEBE10) // Madrid Gold
        .setTitle('<:calculator:1486779811719418088> Calculator')
        .setDescription(`\`\`\`\n${content || "0"}\n\`\`\``)
        .setTimestamp();
    };

    const msg = await message.reply({ embeds: [createEmbed(data)], components: getButtons() });

    const collector = msg.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      time: 180000 
    });

    collector.on('collect', async i => {
      const val = i.customId.split('_')[1];
      const operators = ['+', '-', '×', '÷', '^', '%'];

      if (val === 'Quit') {
        // Send the EPHEMERAL confirmation immediately
        await i.reply({ content: "<:tick:1486733833419358339> Calculator session closed privately.", ephemeral: true });
        collector.stop('user_quit');
        return;
      }

      try {
        if (val === '=') {
          if (!data) return i.deferUpdate();
          let mathQuery = data.replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/log\(/g, 'Math.log10(').replace(/%/g, '/100');
          const openB = (mathQuery.match(/\(/g) || []).length;
          const closeB = (mathQuery.match(/\)/g) || []).length;
          if (openB > closeB) mathQuery += ')'.repeat(openB - closeB);

          const result = new Function(`return ${mathQuery}`)();
          data = String(Number(result).toFixed(4)).replace(/\.?0+$/, ""); 
          isResult = true; 
        } 
        else if (val === 'Clear') { data = ""; isResult = false; }
        else if (val === 'Backspace') { data = data.slice(0, -1); isResult = false; }
        else if (val === 'toggle') {
          if (isResult) isResult = false; 
          data = data.startsWith("-") ? data.slice(1) : "-" + data;
        }
        else {
          if (isResult && !operators.includes(val)) data = ""; 
          isResult = false;
          if (data === "Error") data = "";
          data += val;
        }

        await i.update({ embeds: [createEmbed(data)] });
      } catch (err) {
        data = "Error";
        isResult = false;
        await i.update({ embeds: [createEmbed("Syntax Error")] });
      }
    });

    collector.on('end', async (collected, reason) => {
      const status = reason === 'user_quit' ? 'Closed' : 'Expired';
      await msg.edit({ 
        content: `⏹️ **Calculator ${status}**`, 
        components: getButtons(true) 
      }).catch(() => null);
    });
  },
};