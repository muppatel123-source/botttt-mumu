const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    name: 'gallery',
    description: 'Manage multiple strict gallery channels.',
    usage: 'add <#channel> | remove <#channel> | list | off',
    cooldown: 5,
    userPermissions: [PermissionFlagsBits.Administrator],
    
    data: new SlashCommandBuilder()
        .setName('gallery')
        .setDescription('Set or disable strict gallery channels.')
        .addSubcommand(sub => 
            sub.setName('add')
                .setDescription('Add a gallery channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('The channel to set').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('remove')
                .setDescription('Remove a gallery channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('The channel to remove').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('list')
                .setDescription('List all gallery channels')),

    async execute(message, args) {
        // 🛡️ SAFE FETCH: Convert old string data to array if necessary
        let galleries = message.client.gallery.get(message.guild.id);
        if (typeof galleries === 'string') galleries = [galleries];
        if (!galleries || !Array.isArray(galleries)) galleries = [];

        if (args[0] === 'off') {
            message.client.gallery.delete(message.guild.id);
            return message.reply("✅ **All galleries have been disabled.**");
        }

        const target = message.mentions.channels.first() || message.channel;
        
        if (galleries.includes(target.id)) {
            const newList = galleries.filter(id => id !== target.id);
            message.client.gallery.set(message.guild.id, newList);
            return message.reply(`✅ Removed ${target} from strict galleries.`);
        } else {
            galleries.push(target.id);
            message.client.gallery.set(message.guild.id, galleries);
            return message.reply(`✅ Added ${target} to strict galleries. Only uploads allowed here.`);
        }
    },

    async slashExecute(interaction) {
        const sub = interaction.options.getSubcommand();
        
        // 🛡️ SAFE FETCH: Convert old string data to array if necessary
        let galleries = interaction.client.gallery.get(interaction.guild.id);
        if (typeof galleries === 'string') galleries = [galleries];
        if (!galleries || !Array.isArray(galleries)) galleries = [];

        if (sub === 'list') {
            if (!galleries.length) {
                return interaction.reply({ content: "ℹ️ No strict galleries are currently set.", ephemeral: true });
            }
            const list = galleries.map(id => `<#${id}>`).join(', ');
            return interaction.reply({ content: `🖼️ **Active Strict Galleries:** ${list}`, ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');

        if (sub === 'add') {
            if (galleries.includes(channel.id)) {
                return interaction.reply({ content: `⚠️ ${channel} is already a strict gallery.`, ephemeral: true });
            }
            galleries.push(channel.id);
            interaction.client.gallery.set(interaction.guild.id, galleries);
            return interaction.reply(`✅ Added ${channel} to strict galleries.`);
        } 
        
        if (sub === 'remove') {
            if (!galleries.includes(channel.id)) {
                return interaction.reply({ content: `⚠️ ${channel} is not a strict gallery.`, ephemeral: true });
            }
            const newList = galleries.filter(id => id !== channel.id);
            interaction.client.gallery.set(interaction.guild.id, newList);
            return interaction.reply(`✅ Removed ${channel} from strict galleries.`);
        }
    }
};