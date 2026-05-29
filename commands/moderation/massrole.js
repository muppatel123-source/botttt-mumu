const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'massrole',
    description: 'Add or remove a role from a specific list of User IDs or Mentions.',
    category: 'moderation',
    aliases: ['mr', 'bulkrole'],
    usage: '.massrole <add/remove> <@role/ID> <UserIDs/Mentions...>',
    examples: [
        '.massrole add @TournamentPlayer 123456789 987654321 456789123',
        '.massrole remove @Trialist @User1 @User2 @User3'
    ],
    async execute(message, args) {
        // 1. Permission Check
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply("🚫 **Access Denied.** You need `Manage Roles` permissions.");
        }

        // 2. Argument Validation
        if (args.length < 3) {
            return message.reply("❓ **Usage:** `.massrole <add/remove> <@role/ID> <List of IDs/Mentions>`");
        }

        const action = args[0].toLowerCase();
        if (!['add', 'remove'].includes(action)) {
            return message.reply("❌ Invalid action. Use `add` or `remove`.");
        }

        // 3. Find the Role
        const roleSearch = args[1];
        const role = message.mentions.roles.first() || 
                     message.guild.roles.cache.get(roleSearch.replace(/[<@&>]/g, '')) || 
                     message.guild.roles.cache.find(r => r.name.toLowerCase() === roleSearch.toLowerCase());

        if (!role) return message.reply("❓ **Could not find that role.** Make sure you mention it or provide a valid ID.");

        if (role.position >= message.guild.members.me.roles.highest.position) {
            return message.reply("❌ **Hierarchy Error.** My role is too low to manage this role.");
        }

        // 4. Extract User IDs (removes mentions formatting if present)
        const userList = args.slice(2).map(id => id.replace(/[<@!>]/g, ''));
        
        const waitMsg = await message.reply(`🔄 Processing **${userList.length}** users for the **${role.name}** role...`);

        let successCount = 0;
        let failCount = 0;

        // 5. Execution Loop
        for (const userId of userList) {
            try {
                const member = await message.guild.members.fetch(userId).catch(() => null);
                
                if (member) {
                    if (action === 'add') {
                        if (!member.roles.cache.has(role.id)) await member.roles.add(role);
                    } else {
                        if (member.roles.cache.has(role.id)) await member.roles.remove(role);
                    }
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        // 6. Final Result Embed
        const resultEmbed = new EmbedBuilder()
            .setColor(action === 'add' ? 0x2ECC71 : 0xE74C3C)
            .setTitle(`✅ Mass Role Complete: ${action === 'add' ? 'Added' : 'Removed'}`)
            .setDescription(`Successfully updated **${role.name}** for the provided users.`)
            .addFields(
                { name: '✅ Successful', value: `\`${successCount}\` users`, inline: true },
                { name: '❌ Failed/Not Found', value: `\`${failCount}\` users`, inline: true }
            )
            .setFooter({ text: `Action by ${message.author.tag}` })
            .setTimestamp();

        return waitMsg.edit({ content: null, embeds: [resultEmbed] });
    }
};