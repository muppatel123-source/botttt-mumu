const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'pushhighlight',
    aliases: ['ph'],
    hidden: true,
    description: 'Broadcast a goal highlight (Owner only)',

    data: new SlashCommandBuilder()
        .setName('pushhighlight')
        .setDescription('Broadcast a goal highlight (Owner only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('league').setDescription('League code (PD, PL, etc.)').setRequired(true))
        .addStringOption(opt => opt.setName('match').setDescription('Match name').setRequired(true))
        .addStringOption(opt => opt.setName('goal').setDescription('Goal details').setRequired(true))
        .addAttachmentOption(opt => opt.setName('file').setDescription('Upload Image, GIF, or Video'))
        .addStringOption(opt => opt.setName('url').setDescription('Or paste a link')),

    async execute(message, args) {
        if (message.author.id !== process.env.OWNER_ID) return;
        const league = args[0]?.toUpperCase();
        const match = args[1]; 
        const goal = args[2];
        const media = message.attachments.first()?.url || args[3];

        if (!league || !match || !goal || !media) return message.reply("❌ Usage: `.ph <League> \"Match\" \"Goal\" <Link/Upload>`");
        await this.push(message, league, match, goal, media, false);
    },

    async slashExecute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) return interaction.reply({ content: "❌ Restricted.", ephemeral: true });
        const league = interaction.options.getString('league').toUpperCase();
        const match = interaction.options.getString('match');
        const goal = interaction.options.getString('goal');
        const media = interaction.options.getAttachment('file')?.url || interaction.options.getString('url');
        
        if (!media) return interaction.reply({ content: "❌ No media provided!", ephemeral: true });
        await this.push(interaction, league, match, goal, media, true);
    },

    async push(input, league, matchName, goalInfo, mediaUrl, isSlash) {
        if (isSlash) await input.deferReply({ ephemeral: true });
        let sentCount = 0;

        try {
            let finalMedia = mediaUrl;
            
            // 1. Social Fixers
            if (mediaUrl.includes('twitter.com')) finalMedia = mediaUrl.replace('twitter.com', 'vxtwitter.com');
            else if (mediaUrl.includes('x.com')) finalMedia = mediaUrl.replace('x.com', 'vxtwitter.com');
            else if (mediaUrl.includes('tiktok.com')) finalMedia = mediaUrl.replace('tiktok.com', 'vxtiktok.com');

            // 2. 🛡️ IMPROVED DETECTION
            // We check for images/gifs specifically. 
            // Note: We use .split('?')[0] to ignore any extra URL parameters that break detection.
            const cleanUrl = finalMedia.split('?')[0].toLowerCase();
            const isStaticOrGif = cleanUrl.endsWith('.png') || 
                                  cleanUrl.endsWith('.jpg') || 
                                  cleanUrl.endsWith('.jpeg') || 
                                  cleanUrl.endsWith('.gif') || 
                                  cleanUrl.endsWith('.webp');

            const isVideoFile = cleanUrl.endsWith('.mp4') || 
                                cleanUrl.endsWith('.mov') || 
                                cleanUrl.endsWith('.webm');

            let payload = {};

            if (isStaticOrGif) {
                // --- 🖼️ EMBED MODE (For GIFs and Images) ---
                const embed = new EmbedBuilder()
                    .setColor(0xFEBE10) // Madrid Gold
                    .setTitle(`⚽ GOAL HIGHLIGHT: ${matchName}`)
                    .setDescription(`### ${goalInfo}`)
                    .setImage(finalMedia)
                    .setFooter({ text: `League: ${league} | Official Media` })
                    .setTimestamp();
                payload = { embeds: [embed] };
            } else {
                // --- 📺 VIDEO/LINK MODE (For MP4s and Social Links) ---
                if (isVideoFile) {
                    // Buffer re-upload for direct video files
                    const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
                    const attachment = new AttachmentBuilder(Buffer.from(response.data, 'binary'), { name: `goal_replay.mp4` });
                    
                    payload = { 
                        content: `🔥 **NEW HIGHLIGHT RECEIVED!**\n**${matchName}** | ${goalInfo}\n🏆 *League: ${league}*`, 
                        files: [attachment] 
                    };
                } else {
                    // Standard Social Link (vxtwitter, etc.)
                    payload = { 
                        content: `🔥 **NEW HIGHLIGHT RECEIVED!**\n**${matchName}** | ${goalInfo}\n🏆 *League: ${league}*\n\n${finalMedia}` 
                    };
                }
            }

            // 3. Broadcast
            const guilds = input.client.liveSettings.values();
            for (const settings of guilds) {
                const channel = input.client.channels.cache.get(settings.channelId);
                if (channel && settings.leagues?.includes(league)) {
                    try {
                        await channel.send(payload);
                        sentCount++;
                    } catch (e) { console.error(e.message); }
                }
            }

            const res = `✅ Broadcasted to **${sentCount}** channels.`;
            return isSlash ? input.editReply(res) : input.reply(res);

        } catch (error) {
            console.error(error.message);
            return isSlash ? input.editReply("❌ Error.") : input.reply("❌ Error.");
        }
    }
};