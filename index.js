require('dotenv').config();

const { Events, REST, Routes } = require('discord.js');
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const {
    Client,
    GatewayIntentBits,
    Collection,
    EmbedBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const Enmap = require('enmap').default || require('enmap');
const fs = require('fs');
const path = require('path');
const { getGuildPrefix, DEFAULT_PREFIX } = require('./utils/prefixManager');
const { setupWeb } = require('./web/server');

process.setMaxListeners(20);

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

/*
========================================
1. INITIALIZE DISCORD CLIENT
========================================
*/
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

/*
========================================
2. IMPORT MODELS & ATTACH TO CLIENT
========================================
*/
const {
    Team,
    Player,
    Fixture,
    Blacklist,
    TournamentSettings
} = require('./models/Tournament');

client.db = {
    teams: Team,
    players: Player,
    fixtures: Fixture,
    blacklist: Blacklist,
    tournamentSettings: TournamentSettings
};

/*
========================================
3. CONNECT TO MONGODB
========================================
*/
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Tournament DB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

/*
========================================
4. EXPRESS SERVER LOGIC
========================================
*/

setupWeb(app, client);

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server);

global.io = io; // make it usable everywhere

const port = process.env.PORT || 7860;
server.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Server running on ${port}`);
});

/*
========================================
5. CLIENT SETTINGS & ENMAPS
========================================
*/
const OWNER_ID = process.env.OWNER_ID;

client.commands = new Collection();
client.cooldowns = new Collection();

client.warnings = new Enmap({
    name: 'warnings',
    dataDir: './data'
});

client.liveSettings = new Enmap({
    name: 'liveSettings',
    dataDir: './data'
});

client.afk = new Enmap({
    name: 'afk',
    dataDir: './data'
});

client.greetings = new Enmap({
    name: 'greetings',
    dataDir: './data'
});

client.gallery = new Enmap({
    name: 'gallery',
    dataDir: './data'
});

client.liveStandings = new Enmap({
    name: 'liveStandings',
    dataDir: './data'
});

client.matchCache = new Enmap({
    name: 'matchCache',
    dataDir: './data'
});

const defaultPrefix = DEFAULT_PREFIX;

/*
========================================
6. SAFE COMMAND LOADER
========================================
*/
const foldersPath = path.join(__dirname, 'commands');

if (fs.existsSync(foldersPath)) {
    const commandFolders = fs.readdirSync(foldersPath);

    for (const folder of commandFolders) {
        const commandsPath = path.join(foldersPath, folder);

        if (!fs.lstatSync(commandsPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);

            try {
                delete require.cache[require.resolve(filePath)];
                const command = require(filePath);

                if (!command || !command.name) {
                    console.warn(`⚠️ Skipped invalid command file: ${filePath}`);
                    continue;
                }

                command.category = folder.toLowerCase();
                client.commands.set(command.name, command);

                console.log(`✅ Loaded command: ${command.name} (${folder}/${file})`);
            } catch (error) {
                console.error(`❌ Failed to load command file: ${filePath}`);
                console.error(error);
            }
        }
    }
} else {
    console.warn('⚠️ commands folder not found.');
}

/*
========================================
7. SLASH COMMAND REGISTRATION
========================================
*/
async function registerSlashCommands() {
    if (!process.env.CLIENT_ID) {
        console.warn('⚠️ CLIENT_ID is missing. Slash commands were not registered.');
        return;
    }

    const slashCommands = [];

    for (const command of client.commands.values()) {
        if (command.data && typeof command.data.toJSON === 'function') {
            slashCommands.push({
                name: command.name,
                json: command.data.toJSON()
            });
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log(`🔄 Validating ${slashCommands.length} slash command(s)...`);

        for (let i = 0; i < slashCommands.length; i++) {
            const cmd = slashCommands[i];
            const opts = cmd.json.options || [];

            let foundOptional = false;
            for (let j = 0; j < opts.length; j++) {
                const isRequired = opts[j].required === true;

                if (!isRequired) {
                    foundOptional = true;
                }

                if (isRequired && foundOptional) {
                    console.error(
                        `❌ Invalid option order in command "${cmd.name}" at command index ${i}, option index ${j}`
                    );
                    console.error(
                        'Required options must come before optional ones.'
                    );
                    console.error(
                        JSON.stringify(opts.map(o => ({
                            name: o.name,
                            required: o.required === true
                        })), null, 2)
                    );
                    return;
                }
            }
        }

        console.log(`🔄 Registering ${slashCommands.length} global slash command(s)...`);

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: slashCommands.map(c => c.json) }
        );

        console.log('✅ Global slash commands registered.');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);

        console.log('🔍 Trying individual command registration to find the bad one...');

        for (let i = 0; i < slashCommands.length; i++) {
            const cmd = slashCommands[i];

            try {
                await rest.post(
                    Routes.applicationCommands(process.env.CLIENT_ID),
                    { body: cmd.json }
                );
                console.log(`✅ OK: ${cmd.name}`);
            } catch (singleError) {
                console.error(`❌ Broken command found: ${cmd.name} (index ${i})`);
                console.error(singleError.rawError || singleError);
                break;
            }
        }
    }
}

/*
========================================
8. READY EVENT
========================================
*/
client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    await registerSlashCommands();

    const now = Date.now();
    const matchKeys = client.matchCache.keys();

    for (const key of matchKeys) {
        const val = client.matchCache.get(key);
        if (val && val.timestamp && (now - val.timestamp > 18000000)) {
            client.matchCache.delete(key);
        }
    }

    console.log(`🧹 Match cache cleaned. Monitoring ${matchKeys.length} active/recent matches.`);

    try {
        const { checkGoals } = require('./utils/goalAlerts');
        setInterval(() => {
            checkGoals(client);
        }, 25000);
    } catch (error) {
        console.error('❌ Failed to start goal alert system:', error);
    }
});

client.on('error', (error) => {
    console.error('❌ Discord Client Error:', error);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord Warning:', warning);
});

/*
========================================
9. HELPER FUNCTION: COMMAND HANDLER
========================================
*/
async function runCommand(command, input, args, isSlash) {
    const userId = isSlash ? input.user.id : input.author.id;
    const isOwner = userId === OWNER_ID;
    const guildId = input.guild.id;

    const prefix = await getGuildPrefix(guildId);

    const isBlacklisted = await client.db.blacklist.findOne({ userId });
    if (isBlacklisted) {
        const banEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setAuthor({ name: 'VAR REVIEW: ACCESS DENIED', iconURL: 'https://i.imgur.com/8E9v6I6.png' })
            .setTitle('🚫 PERMANENT EMBARGO')
            .setDescription(`### 🛑 STOP!\nYour account is currently under a **Permanent Bot Embargo**.\n\n**Reason:** \`${isBlacklisted.reason || 'Violation of Bot Integrity'}\``)
            .setFooter({ text: 'The Crown sees everything.' });

        if (isSlash) return input.reply({ embeds: [banEmbed], ephemeral: true });
        return input.reply({ embeds: [banEmbed] }).then(m => setTimeout(() => m.delete().catch(() => null), 6000));
    }

    if (!client.cooldowns.has(command.name)) {
        client.cooldowns.set(command.name, new Collection());
    }

    const now = Date.now();
    const timestamps = client.cooldowns.get(command.name);
    const cooldownAmount = (command.cooldown || 3) * 1000;

    if (timestamps.has(userId) && !isOwner) {
        const expirationTime = timestamps.get(userId) + cooldownAmount;
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            const msg = `🐌 **Slow down!** Wait **${timeLeft.toFixed(1)}s** before using \`${command.name}\` again.`;
            return isSlash ? input.reply({ content: msg, ephemeral: true }) : input.reply(msg);
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownAmount);

    if (command.userPermissions && !isOwner && !input.member.permissions.has(command.userPermissions)) {
        const msg = '🚫 **Access Denied.** You lack the required permissions.';
        return isSlash ? input.reply({ content: msg, ephemeral: true }) : input.reply(msg);
    }

    if (command.botPermissions && !input.guild.members.me.permissions.has(command.botPermissions)) {
        const msg = `❌ I am missing required permissions: \`${command.botPermissions.join(', ')}\``;
        return isSlash ? input.reply({ content: msg, ephemeral: true }) : input.reply(msg);
    }

    try {
        if (isSlash) {
            if (command.slashExecute) {
                await command.slashExecute(input);
            } else {
                await input.reply({ content: 'This command is prefix-only for now!', ephemeral: true });
            }
        } else {
            await command.execute(input, args);
        }

        const logChannelId = '1487522313854390435';
        const logChannel = client.channels.cache.get(logChannelId);

        if (logChannel) {
            const safeArgs = Array.isArray(args) ? args.join(' ') : '';
            const logContent = isSlash
                ? `/${command.name}`
                : `${prefix}${command.name} ${safeArgs}`.trim();

            const logEmbed = new EmbedBuilder()
                .setColor('#3498DB')
                .setAuthor({ name: `Command Log: ${command.name}`, iconURL: input.guild.iconURL() })
                .addFields(
                    { name: '👤 User', value: `${input.member.user.tag} (\`${userId}\`)`, inline: true },
                    { name: '📍 Channel', value: `<#${input.channel.id}>`, inline: true },
                    { name: '⌨️ Type', value: isSlash ? 'Slash Command' : 'Prefix Command', inline: true },
                    { name: '📝 Content', value: `\`${logContent}\``.substring(0, 1024) }
                )
                .setTimestamp();

            logChannel.send({ embeds: [logEmbed] }).catch(() => null);
        }
    } catch (error) {
        console.error(`❌ Error executing command "${command.name}":`, error);

        const errContent = { content: 'There was an error executing this command!', ephemeral: true };

        if (isSlash) {
            if (input.deferred || input.replied) await input.editReply(errContent);
            else await input.reply(errContent);
        } else {
            await input.reply({ content: 'There was an error executing this command!' }).catch(() => null);
        }
    }
}

/*
========================================
10. INTERACTION EVENT
========================================
*/
client.on('interactionCreate', async (interaction) => {
    /*
    ========================================
    10A. SLASH COMMANDS
    ========================================
    */
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) {
            await runCommand(command, interaction, null, true);
        }
        return;
    }

    /*
    ========================================
    10B. BUTTONS
    ========================================
    */
    if (!interaction.isButton()) return;

    try {
        /*
        ========================================
        DRAW TEAM BUTTON
        ========================================
        */
        if (interaction.customId.startsWith('draw_team_')) {
            const starterId = interaction.customId.split('_')[2];

            if (interaction.user.id !== starterId) {
                return interaction.reply({
                    content: '🚫 Only the organizer who started the draw can use this button.',
                    ephemeral: true
                });
            }

            const settings = await client.db.tournamentSettings.findOne({
                guildId: interaction.guild.id
            });

            if (!settings) {
                return interaction.reply({
                    content: '❌ Tournament settings not found.',
                    ephemeral: true
                });
            }

            const teams = await client.db.teams.find({
                guildId: interaction.guild.id
            });

            if (!teams.length) {
                return interaction.reply({
                    content: '❌ No teams found.',
                    ephemeral: true
                });
            }

            const undrawnTeams = teams.filter(team => !team.groupKey);

            if (!undrawnTeams.length) {
                const completeEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('🏆 GROUP DRAW COMPLETED')
                    .setDescription(
                        'All teams have been drawn successfully.\n\n' +
                        'Would you like to generate fixtures now?'
                    )
                    .addFields(
                        {
                            name: 'Option 1',
                            value: '✅ Auto-generate fixtures now',
                            inline: false
                        },
                        {
                            name: 'Option 2',
                            value: '❌ Keep manual mode for fixtures',
                            inline: false
                        }
                    )
                    .setFooter({
                        text: 'Organizer Controlled Tournament Flow'
                    })
                    .setTimestamp();

                const completeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`generate_fixtures_${starterId}`)
                        .setLabel('✅ Generate Fixtures')
                        .setStyle(ButtonStyle.Success),

                    new ButtonBuilder()
                        .setCustomId(`manual_fixtures_${starterId}`)
                        .setLabel('❌ Manual Mode')
                        .setStyle(ButtonStyle.Secondary)
                );

                return interaction.update({
                    embeds: [completeEmbed],
                    components: [completeRow]
                });
            }

            const randomTeam = undrawnTeams[Math.floor(Math.random() * undrawnTeams.length)];

            const groupCount = settings.groupCount || 2;

            const groupKeys = Array.from(
                { length: groupCount },
                (_, i) => String.fromCharCode(65 + i)
            );

            let selectedGroup = null;
            let lowestCount = Infinity;

            for (const group of groupKeys) {
                const count = await client.db.teams.countDocuments({
                    guildId: interaction.guild.id,
                    groupKey: group
                });

                if (count < lowestCount) {
                    lowestCount = count;
                    selectedGroup = group;
                }
            }

            randomTeam.groupKey = selectedGroup;
            await randomTeam.save();

            let groupText = '';

            for (const group of groupKeys) {
                const groupTeams = await client.db.teams.find({
                    guildId: interaction.guild.id,
                    groupKey: group
                });

                const names = groupTeams.length
                    ? groupTeams.map(t => `• ${t.name}`).join('\n')
                    : '*Waiting...*';

                groupText += `### Group ${group}\n${names}\n\n`;
            }

            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('🏆 LIVE GROUP DRAW')
                .setDescription(
                    `✨ **${randomTeam.name}** has been drawn!\n` +
                    `→ Assigned to **Group ${selectedGroup}**\n\n` +
                    groupText
                )
                .setFooter({
                    text: 'Organizer Controlled Draw'
                })
                .setTimestamp();

            return interaction.update({
                embeds: [embed]
            });
        }

        /*
        ========================================
        GENERATE FIXTURES BUTTON
        ========================================
        */
        if (interaction.customId.startsWith('generate_fixtures_')) {
            const starterId = interaction.customId.split('_')[2];

            if (interaction.user.id !== starterId) {
                return interaction.reply({
                    content: '🚫 Only the organizer can use this button.',
                    ephemeral: true
                });
            }

            const settings = await client.db.tournamentSettings.findOne({
                guildId: interaction.guild.id
            });

            if (!settings) {
                return interaction.reply({
                    content: '❌ Tournament settings not found.',
                    ephemeral: true
                });
            }

            const existingFixtures = await client.db.fixtures.countDocuments({
                guildId: interaction.guild.id
            });

            if (existingFixtures > 0) {
                return interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE67E22)
                            .setTitle('⚠️ FIXTURES ALREADY EXIST')
                            .setDescription(
                                `This tournament already has **${existingFixtures}** fixture(s).\n\n` +
                                `Please clear old fixtures first before auto-generating again.`
                            )
                            .setTimestamp()
                    ],
                    components: []
                });
            }

            const teams = await client.db.teams.find({
                guildId: interaction.guild.id
            });

            if (!teams.length) {
                return interaction.reply({
                    content: '❌ No teams found.',
                    ephemeral: true
                });
            }

            const homeAway = settings.homeAway || false;
            const groupCount = settings.groupCount || 0;

            let createdFixtures = [];
            let nextMatchNumber = await getNextMatchNumber(interaction.guild.id);

            if (groupCount > 0) {
                const groupKeys = Array.from(
                    { length: groupCount },
                    (_, i) => String.fromCharCode(65 + i)
                );

                for (const group of groupKeys) {
                    const groupTeams = await client.db.teams.find({
                        guildId: interaction.guild.id,
                        groupKey: group
                    });

                    if (groupTeams.length < 2) continue;

                    const fixtures = generateRoundRobinFixtures({
                        guildId: interaction.guild.id,
                        teams: groupTeams.map(team => ({ name: team.name })),
                        phase: 'group',
                        roundPrefix: 'Group Matchday',
                        homeAway,
                        groupKey: group,
                        startMatchNumber: nextMatchNumber
                    });

                    nextMatchNumber += fixtures.length;
                    createdFixtures.push(...fixtures);
                }
            } else {
                const fixtures = generateRoundRobinFixtures({
                    guildId: interaction.guild.id,
                    teams: teams.map(team => ({ name: team.name })),
                    phase: 'league',
                    roundPrefix: 'Matchday',
                    homeAway,
                    groupKey: null,
                    startMatchNumber: nextMatchNumber
                });

                createdFixtures.push(...fixtures);
            }

            if (!createdFixtures.length) {
                return interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE74C3C)
                            .setTitle('❌ NO FIXTURES GENERATED')
                            .setDescription(
                                'No fixtures could be generated from the current draw/setup.'
                            )
                            .setTimestamp()
                    ],
                    components: []
                });
            }

            await client.db.fixtures.insertMany(createdFixtures);

            return interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('📅 FIXTURES GENERATED')
                        .setDescription(
                            `Successfully created **${createdFixtures.length}** fixture(s).\n\n` +
                            `🏆 Format: **${groupCount > 0 ? 'Groups + Knockout' : 'League'}**\n` +
                            `🔁 Home & Away: **${homeAway ? 'Enabled' : 'Disabled'}**`
                        )
                        .setTimestamp()
                ],
                components: []
            });
        }

        /*
        ========================================
        MANUAL FIXTURES BUTTON
        ========================================
        */
        if (interaction.customId.startsWith('manual_fixtures_')) {
            const starterId = interaction.customId.split('_')[2];

            if (interaction.user.id !== starterId) {
                return interaction.reply({
                    content: '🚫 Only the organizer can use this button.',
                    ephemeral: true
                });
            }

            return interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x95A5A6)
                        .setTitle('🛠️ MANUAL FIXTURE MODE SELECTED')
                        .setDescription(
                            'Group draw is complete.\n\n' +
                            'You chose manual scheduling mode for fixtures.'
                        )
                        .setTimestamp()
                ],
                components: []
            });
        }
    } catch (error) {
        console.error('❌ interactionCreate button error:', error);

        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({
                content: '❌ Button interaction failed.',
                ephemeral: true
            });
        }
    }
});

/*
========================================
11. MEMBER EVENTS
========================================
*/
client.on('guildMemberAdd', async (member) => {
    const data = client.greetings.get(member.guild.id) || {};

    if (data.autoRole) {
        const role = member.guild.roles.cache.get(data.autoRole);
        if (role) member.roles.add(role).catch(() => null);
    }

    const welcomeChannel = member.guild.channels.cache.get(data.welcomeChannel);
    if (welcomeChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xFEBE10)
            .setTitle('✨ A New Member Has Arrived!')
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
            .setDescription(`Welcome to **${member.guild.name}**, ${member}!\n\n📊 **Member Count:** \`#${member.guild.memberCount}\`\n📅 **Joined Discord:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:D>\n\n💬 Be sure to check the rules and enjoy your stay.\n`)
            .setFooter({ text: `User ID: ${member.id}` })
            .setTimestamp();

        welcomeChannel.send({ content: `🎊 Welcome ${member}!`, embeds: [embed] }).catch(() => null);
    }
});

client.on('guildMemberRemove', async (member) => {
    const data = client.greetings.get(member.guild.id) || {};
    const leaveChannel = member.guild.channels.cache.get(data.leaveChannel);

    if (leaveChannel) {
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setAuthor({ name: 'Member Departed', iconURL: member.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`**${member.user.tag}** has left the server.`)
            .setTimestamp();

        leaveChannel.send({ embeds: [embed] }).catch(() => null);
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const oldStatus = oldMember.premiumSince;
    const newStatus = newMember.premiumSince;

    if (!oldStatus && newStatus) {
        const data = client.greetings.get(newMember.guild.id) || {};

        if (data.boostRole) {
            const role = newMember.guild.roles.cache.get(data.boostRole);
            if (role) newMember.roles.add(role).catch(() => null);
        }

        const boostChannel = newMember.guild.channels.cache.get(data.boostChannel);
        if (boostChannel) {
            const embed = new EmbedBuilder()
                .setColor(0xFF73FA)
                .setTitle('🚀 Server Power-Up!')
                .setDescription(`✨ **HUGE THANKS TO ${newMember}!**\nYou just boosted the server!`)
                .setTimestamp();

            boostChannel.send({ content: `🎊 **New Booster:** ${newMember}`, embeds: [embed] }).catch(() => null);
        }
    }
});

/*
========================================
12. MESSAGE EVENT
========================================
*/
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = await getGuildPrefix(message.guild.id);

    const userAfk = client.afk.get(message.author.id);
    if (userAfk && !message.content.startsWith(`${prefix}afk`)) {
        if (userAfk.oldNickname && message.member.manageable) {
            await message.member.setNickname(userAfk.oldNickname).catch(() => null);
        }
        client.afk.delete(message.author.id);
        message.reply(`👋 Welcome back **${message.author.username}**, I have removed your AFK.`)
            .then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    }

    if (message.mentions.members.size > 0) {
        message.mentions.members.forEach(member => {
            const afkData = client.afk.get(member.id);
            if (afkData) {
                message.reply(`💤 **${member.user.username}** is currently AFK: ${afkData.reason} - <t:${Math.floor(afkData.time / 1000)}:R>`)
                    .catch(() => null);
            }
        });
    }

    if (message.mentions.has(client.user) && !message.mentions.everyone) {
        await message.react('<:hello:1488633282462744767>').catch(() => null);
    }

    const galleryIds = client.gallery.get(message.guild.id);
    if (galleryIds && Array.isArray(galleryIds) && galleryIds.includes(message.channel.id)) {
        if (message.attachments.size === 0) {
            const isStaff =
                message.author.id === message.guild.ownerId ||
                message.member.permissions.has(PermissionFlagsBits.Administrator) ||
                message.member.permissions.has(PermissionFlagsBits.ManageMessages);

            if (!isStaff) {
                await message.delete().catch(() => null);
                return message.channel.send(`⚠️ ${message.author}, this is a **Strict Gallery**. Only uploads allowed.`)
                    .then(m => setTimeout(() => m.delete().catch(() => null), 4000));
            }
        }
    }

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command =
        client.commands.get(commandName) ||
        client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

    if (command) {
        await runCommand(command, message, args, false);
    }
});

/*
========================================
13. HELPER FUNCTIONS FOR DRAW/FIXTURES
========================================
*/
async function getNextMatchNumber(guildId) {
    const lastFixture = await client.db.fixtures.findOne({ guildId }).sort({ matchNumber: -1 });
    if (!lastFixture || !lastFixture.matchNumber) return 1;
    return lastFixture.matchNumber + 1;
}

function generateRoundRobinFixtures({
    guildId,
    teams,
    phase,
    roundPrefix,
    homeAway = false,
    groupKey = null,
    startMatchNumber = 1
}) {
    const teamList = [...teams];

    if (teamList.length % 2 !== 0) {
        teamList.push({ name: '__BYE__' });
    }

    const rounds = [];
    const totalRounds = teamList.length - 1;
    const half = teamList.length / 2;

    let rotation = [...teamList];

    for (let round = 0; round < totalRounds; round++) {
        const pairings = [];

        for (let i = 0; i < half; i++) {
            const home = rotation[i];
            const away = rotation[rotation.length - 1 - i];

            if (home.name === '__BYE__' || away.name === '__BYE__') continue;

            pairings.push([home, away]);
        }

        rounds.push(pairings);

        const fixed = rotation[0];
        const rest = rotation.slice(1);
        rest.unshift(rest.pop());
        rotation = [fixed, ...rest];
    }

    const fixtures = [];
    let matchNumber = startMatchNumber;

    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
        const roundLabel = `${roundPrefix} ${roundIndex + 1}`;

        for (const [home, away] of rounds[roundIndex]) {
            fixtures.push({
                guildId,
                phase,
                roundLabel,
                groupKey,
                leg: 1,
                matchNumber: matchNumber++,
                homeTeam: home.name,
                awayTeam: away.name,
                venueType: 'home',
                venueName: 'Home Ground',
                scheduledAt: null,
                status: 'Pending',
                result: {
                    home: null,
                    away: null,
                    extraTimeHome: null,
                    extraTimeAway: null,
                    penaltiesHome: null,
                    penaltiesAway: null,
                    winner: ''
                },
                aggregateTieKey: null,
                notes: '',
                bracket: {
                    advancesToMatchNumber: null,
                    slot: ''
                }
            });

            if (homeAway) {
                fixtures.push({
                    guildId,
                    phase,
                    roundLabel: `${roundPrefix} ${roundIndex + 1 + rounds.length}`,
                    groupKey,
                    leg: 1,
                    matchNumber: matchNumber++,
                    homeTeam: away.name,
                    awayTeam: home.name,
                    venueType: 'home',
                    venueName: 'Home Ground',
                    scheduledAt: null,
                    status: 'Pending',
                    result: {
                        home: null,
                        away: null,
                        extraTimeHome: null,
                        extraTimeAway: null,
                        penaltiesHome: null,
                        penaltiesAway: null,
                        winner: ''
                    },
                    aggregateTieKey: null,
                    notes: '',
                    bracket: {
                        advancesToMatchNumber: null,
                        slot: ''
                    }
                });
            }
        }
    }

    return fixtures;
}

/*
========================================
14. LOGIN
========================================
*/
console.log('TOKEN STATUS:', process.env.DISCORD_TOKEN ? 'Loaded' : 'Missing');
console.log('TOKEN LENGTH:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 0);
console.log('🚀 Attempting Discord login...');

client.on('debug', console.log);

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing in runtime environment');
} else {
    client.login(process.env.DISCORD_TOKEN)
        .then(() => {
            console.log('🔐 Login request sent to Discord');
        })
        .catch((err) => {
            console.error('❌ Discord login failed:', err);
        });
}
