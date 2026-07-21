const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'rules',
    description: 'Post the official server rules in a professional Galáctico embed.',
    permissions: [PermissionFlagsBits.Administrator],
    async execute(message, args) {
        const embed = new EmbedBuilder()
            .setColor(0xFEBE10) // Madrid Gold
            .setTitle('👑 THE GALÁCTICO PROTOCOL: SERVER RULES')
            .setAuthor({ name: `${message.guild.name} Official Charter`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setThumbnail('https://i.imgur.com/8E9v6I6.png') // Gold Crown/Logo
            .setDescription(
                `Welcome to the home of the Kings! To maintain the standards of **${message.guild.name}**, all members must adhere to the following code of conduct. \n\n*Failure to comply will result in a VAR review (Moderation Action).*`
            )
            .addFields(
                { 
                    name: '🛡️ SECTION I: THE CODE OF CONDUCT', 
                    value: 
                    `**1. Respect Everyone:** No harassment, bullying, sexism, or hate speech.\n` +
                    `**2. No NSFW:** Keep the pitch clean. No inappropriate content.\n` +
                    `**3. No Spamming:** Avoid excessive messages, emojis, or pings.\n` +
                    `**4. Legal Safety:** No piracy, doxxing, or dangerous material.\n` +
                    `**5. No Advertising:** No promotion of other servers/services.`,
                    inline: false 
                },
                { 
                    name: '⚽ SECTION II: MATCHDAY ETIQUETTE', 
                    value: 
                    `**6. Proper Channels:** Keep talk in designated areas.\n` +
                    `**7. Respect Staff:** Follow moderator instructions.\n` +
                    `**8. Profile Safety:** No offensive names or avatars.\n` +
                    `**9. No Mic Spam:** No annoying or loud noises in VC.\n` +
                    `**10. No VC Hopping:** Don't jump between channels.`,
                    inline: false 
                },
                { 
                    name: '🔐 SECTION III: SECURITY & PRIVACY', 
                    value: 
                    `**11. No Doxxing:** 🟥 **Immediate Permanent Ban.**\n` +
                    `**12. No Phishing:** No "Free Nitro" or scam links.\n` +
                    `**13. DM Privacy:** Do not share private DMs without consent.\n` +
                    `**14. Link Descriptions:** No "naked" links; describe your content.`,
                    inline: false 
                },
                { 
                    name: '🤖 SECTION IV: TECHNICAL USAGE', 
                    value: 
                    `**15. Bot Channels:** Use #bot-commands for mini-games/music.\n` +
                    `**16. No Bot Abuse:** Don't try to lag or break Mumu's systems.`,
                    inline: false 
                }
            )
            .setImage('https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExcHdiejhxYm41bDE4N3p4MngyNXk0OHk5Y2YwdHU2MGNzb2ZrOHV0cCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/acWQu3WET6qcpsFdkK/giphy.gif') // A sleek horizontal separator or Madrid-themed banner
            .setFooter({ text: 'By joining, you agree to these terms.', iconURL: 'https://i.imgur.com/H8iN8G9.png' })
            .setTimestamp();

        // Optional: Add a button to "Accept" rules if you have a verification system
        return message.channel.send({ embeds: [embed] });
    },
};