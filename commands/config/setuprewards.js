const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    name: 'setuprewards',
    description: 'Assign roles to levels.',
    cooldown: 10,
    userPermissions: [PermissionFlagsBits.Administrator],
    data: new SlashCommandBuilder()
        .setName('setuprewards')
        .setDescription('Configure level-based role rewards.'),

    async execute(message) {
        await this.logic(message, message.author);
    },

    async slashExecute(interaction) {
        await interaction.deferReply();
        await this.logic(interaction, interaction.user);
    },

   async logic(input, user) {
        const guild = input.guild;
        const roles = guild.roles.cache
            .filter(r => r.name !== "@everyone" && !r.managed)
            .sort((a, b) => b.position - a.position)
            .first(25);
            
        const options = roles.map(r => ({ 
            label: r.name, 
            value: r.id, 
            description: `ID: ${r.id}` 
        }));

        const embed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('🏆 Level Rewards Configuration')
            .setDescription('**Step 1:** Select a role from the dropdown.\n**Step 2:** Type the level in the prompt that appears.');

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('reward_role_select')
                .setPlaceholder('Choose a role...')
                .addOptions(options)
        );
        
        const btn = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reward_finish')
                .setLabel('Finish Setup')
                .setStyle(ButtonStyle.Success)
        );

        // 🛠️ THE FIX: Check if it's an interaction. If yes, use editReply because it was deferred.
        const msg = input.isChatInputCommand?.() 
            ? await input.editReply({ embeds: [embed], components: [row, btn] }) 
            : await input.reply({ embeds: [embed], components: [row, btn] });

        const collector = msg.createMessageComponentCollector({ 
            filter: i => i.user.id === user.id, 
            idle: 60000 
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'reward_finish') {
                await interaction.update({ content: '✅ Setup closed.', embeds: [], components: [] });
                return collector.stop();
            }

            if (interaction.customId === 'reward_role_select') {
                const selectedRoleId = interaction.values[0];
                const roleName = guild.roles.cache.get(selectedRoleId).name;

                const prompt = await interaction.reply({ 
                    content: `Which level should unlock **${roleName}**? (Send just the number)`, 
                    fetchReply: true 
                });

                const filter = m => m.author.id === user.id && !isNaN(m.content);
                const collected = await input.channel.awaitMessages({ filter, max: 1, time: 15000 });

                if (collected.size > 0) {
                    const level = collected.first().content;
                    input.client.rewards.ensure(guild.id, {});
                    input.client.rewards.set(guild.id, selectedRoleId, level);

                    await collected.first().delete().catch(() => null);
                    await prompt.delete().catch(() => null);

                    const successEmbed = EmbedBuilder.from(embed)
                        .setFields({ name: 'Last Added', value: `Level **${level}** ➔ <@&${selectedRoleId}>` });

                    await msg.edit({ embeds: [successEmbed] });
                } else {
                    await prompt.edit('❌ Timed out or invalid number. Please select again.');
                }
            }
        });
    }
};