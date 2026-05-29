const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'role',
    description: 'Smart Role Management with Toggle, Add, Remove, and Mass-Role.',
    category: 'moderation',
    aliases: ['r', 'setrole'],
    usage: '.role <@user/ID/all/humans/bots> [+/-]<@role/ID/Name>',
    examples: [
        '.role @User +@Moderator',
        '.role all @Member',
        '.role humans +@Verified',
        '.role bots -@Testing'
    ],
    async execute(message, args) {
        // --- UPDATED PERMISSION CHECK (OWNER BYPASS) ---
        const isOwner = message.author.id === process.env.OWNER_ID;
        const hasPerms = message.member.permissions.has(PermissionFlagsBits.ManageRoles);

        if (!isOwner && !hasPerms) {
            return message.reply("🚫 **Access Denied.**");
        }
        // -----------------------------------------------

        // ❓ Help Guide
        if (!args.length || !args[0]) {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x2B2D31)
                .setTitle('🛠️ Role Command Guide')
                .setDescription('**Manage server roles with smart detection.**')
                .addFields(
                    { 
                        name: '➕ **Add Role**', 
                        value: '`.role @user +@role` \n `.role add @user @role` \n `.role all/humans/bots +@role`', 
                        inline: true 
                    },
                    { 
                        name: '➖ **Remove Role**', 
                        value: '`.role @user -@role` \n `.role remove @user @role` \n `.role all/humans/bots -@role`', 
                        inline: true 
                    },
                    { 
                        name: '🔄 **Toggle Role**', 
                        value: '`.role @user @role` \n *(Adds if missing, removes if present)*', 
                        inline: false 
                    },
                    { 
                        name: '💡 **Tip**', 
                        value: 'You can use **User IDs** or **Role Names** too!' 
                    }
                )
                .setFooter({ text: `Requested by ${message.author.tag}` })
                .setTimestamp();
            return message.reply({ embeds: [helpEmbed] });
        }

        const targetArg = args[0].toLowerCase();
        const isMassRole = ['all', 'humans', 'bots'].includes(targetArg);

        // Define Action and Role Search string
        let action = 'toggle';
        let roleSearch = args.slice(1).join(' ');

        if (args[1]) {
            const lowArg = args[1].toLowerCase();
            if (args[1].startsWith('+') || lowArg === 'add') {
                action = 'add';
                roleSearch = args[1].startsWith('+') ? args[1].slice(1) : args.slice(2).join(' ');
            } else if (args[1].startsWith('-') || lowArg === 'remove') {
                action = 'remove';
                roleSearch = args[1].startsWith('-') ? args[1].slice(1) : args.slice(2).join(' ');
            }
        }

        const role = message.mentions.roles.first() || 
                     message.guild.roles.cache.get(roleSearch) || 
                     message.guild.roles.cache.find(r => r.name.toLowerCase().includes(roleSearch.toLowerCase()));

        if (!role) return message.reply("❓ **Which role?**");

        if (role.position >= message.guild.members.me.roles.highest.position) {
            return message.reply("❌ **Hierarchy Error.** My role is too low.");
        }

        // --- Logic for Individual Target ---
        if (!isMassRole) {
            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            if (!target) return message.reply("❓ **Who?** Mention a user, use an ID, or use `all/humans/bots`.");

            try {
                let finalStatus = "";
                if (action === 'add' || (action === 'toggle' && !target.roles.cache.has(role.id))) {
                    await target.roles.add(role);
                    finalStatus = "Added";
                } else {
                    await target.roles.remove(role);
                    finalStatus = "Removed";
                }

                const resEmbed = new EmbedBuilder()
                    .setColor(finalStatus === "Added" ? 0x2ECC71 : 0xE74C3C)
                    .setDescription(`${finalStatus === "Added" ? '✅' : '🗑️'} **${role.name}** has been **${finalStatus.toLowerCase()}** for ${target}.`)
                    .setFooter({ text: `Requested by ${message.author.tag}` })
                    .setTimestamp();

                return message.channel.send({ embeds: [resEmbed] });
            } catch (err) {
                console.error(err);
                return message.reply("⚠️ **Error.** Check permissions.");
            }
        }

        // --- Logic for Mass Role (all/humans/bots) ---
        const waitMsg = await message.reply(`🔄 Processing mass-role for **${targetArg}**... This may take a moment.`);
        
        let members = await message.guild.members.fetch();
        if (targetArg === 'humans') members = members.filter(m => !m.user.bot);
        if (targetArg === 'bots') members = members.filter(m => m.user.bot);

        let count = 0;
        try {
            for (const [id, member] of members) {
                if (action === 'add') {
                    if (!member.roles.cache.has(role.id)) {
                        await member.roles.add(role).catch(() => null);
                        count++;
                    }
                } else if (action === 'remove') {
                    if (member.roles.cache.has(role.id)) {
                        await member.roles.remove(role).catch(() => null);
                        count++;
                    }
                } else { // Toggle logic
                    if (member.roles.cache.has(role.id)) {
                        await member.roles.remove(role).catch(() => null);
                    } else {
                        await member.roles.add(role).catch(() => null);
                    }
                    count++;
                }
            }

            const massEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setDescription(`✅ Successfully updated **${role.name}** for **${count}** ${targetArg}.`)
                .setFooter({ text: `Requested by ${message.author.tag}` })
                .setTimestamp();

            await waitMsg.edit({ content: null, embeds: [massEmbed] });
        } catch (err) {
            console.error(err);
            waitMsg.edit("⚠️ **Error during mass-role process.**");
        }
    }
};