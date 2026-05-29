const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'manage-live',
    aliases: ['edit-live', 'stop-live', 'reset-live'],
    description: 'Manage, edit, or reset the live goal alerts for this server.',
    usage: '<edit #channel [leagues]> | <reset>',
    permissions: PermissionFlagsBits.ManageChannels, // Owner bypass will apply here!
    async execute(message, args) {
        const guildId = message.guild.id;
        const currentSettings = message.client.liveSettings.get(guildId);

        if (!currentSettings) {
            return message.reply("<a:error:1486745155775234309> No live alerts are currently set up for this server. Use `.set-live` first!");
        }

        // --- 🔴 RESET / STOP LOGIC ---
        if (args[0]?.toLowerCase() === 'reset' || args[0]?.toLowerCase() === 'stop') {
            message.client.liveSettings.delete(guildId);
            return message.reply("🛑 **Live Alerts Disabled.** I have removed all goal alert settings for this server.");
        }

        // --- ⚙️ EDIT / TRANSFER LOGIC ---
        if (args[0]?.toLowerCase() === 'edit') {
            const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
            
            if (!targetChannel) {
                return message.reply("<a:error:1486745155775234309> Please mention a new channel! Usage: `.manage-live edit #new-channel [leagues]`");
            }

            // If they provided new leagues, update them. Otherwise, keep the old ones.
            const newLeagues = args.slice(2).length > 0 ? args.slice(2).map(l => l.toUpperCase()) : currentSettings.leagues;

            const updatedSettings = {
                channelId: targetChannel.id,
                leagues: newLeagues,
                guildName: message.guild.name
            };

            message.client.liveSettings.set(guildId, updatedSettings);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('⚙️ Live Alerts Updated')
                .setDescription(`I have successfully updated your goal alert settings!`)
                .addFields(
                    { name: '🏟️ New Channel', value: `<#${targetChannel.id}>`, inline: true },
                    { name: '🏆 Active Leagues', value: `\`${newLeagues.join(', ')}\``, inline: true }
                )
              //  .setFooter({ text: 'Goal alerts will continue to sync every 60s.' });

            return message.reply({ embeds: [embed] });
        }

        // --- ℹ️ CURRENT STATUS (If they just type the command) ---
        const statusEmbed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('📡 Current Live Alert Settings')
            .addFields(
                { name: 'Channel', value: `<#${currentSettings.channelId}>`, inline: true },
                { name: 'Leagues', value: `\`${currentSettings.leagues.join(', ')}\``, inline: true }
            )
            .setFooter({ text: 'Use .manage-live edit #channel [leagues] to change or .manage-live reset to stop.' });

        message.reply({ embeds: [statusEmbed] });
    },
};