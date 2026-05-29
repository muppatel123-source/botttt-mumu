const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');

module.exports = {
  name: 'oilup',
  category: 'fun',
  description: 'Tells someone it is time to oil up...',
  usage: '.oilup <@user>',
  async execute(message, args) {
    const target = message.mentions.users.first();

    if (!target) return message.reply("<a:Cross_:1486728686005649650> Mention a victim! Usage: `.oilup @user` ");
    if (target.id === message.author.id) return message.reply("<:Smirk_Smirk:1486734982939410554> Oiling yourself up? At least get a room first.");

    // 1. List of your local file names and messages
    const oilChaos = [
      { msg: `Don't make me ask twice, **${target.username}**. OIL. UP. <:BabyOil:1486735244588486716><:skulllllll:1486735492513792112>`, file: 'oil1.gif' },
      { msg: `I'm coming over, **${target.username}**. Start oiling up. <:oilup:1486735224565010474>✨`, file: 'oil2.gif' },
      { msg: `The friction is too high, **${target.username}**. Oil up. Now. <:oilDrops:1486735759938556078>`, file: 'oil3.gif' }
    ];

    const random = oilChaos[Math.floor(Math.random() * oilChaos.length)];
    
    // 2. Point to the local path
    const filePath = path.join(__dirname, '../../assets/', random.file);
    const attachment = new AttachmentBuilder(filePath, { name: 'oilup.gif' });

    // 3. Create the Embed
    const oilEmbed = new EmbedBuilder()
      .setColor(0xFEBE10) // Madrid Gold
      .setTitle('<:BabyOil:1486735244588486716> Time to Oil Up')
      .setDescription(random.msg)
      .setImage('attachment://oilup.gif')
      .setFooter({ 
        text: `Requested by ${message.author.username} | Total Bot Commands: ${message.client.commands.size}`, 
        iconURL: message.author.displayAvatarURL() 
      });

    return message.reply({ embeds: [oilEmbed], files: [attachment] });
  },
};