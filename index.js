require('dotenv').config();

const { Events, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const {
    Client,
    GatewayIntentBits,
    Collection,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');
const Enmap = require('enmap').default || require('enmap');
const fs = require('fs');
const path = require('path');
const { getGuildPrefix, DEFAULT_PREFIX } = require('./utils/prefixManager');

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
4. EXPRESS / SOCKET.IO (STUB)
   Web panel removed — keeping a minimal
   socket.io instance for future use.
   Tournament commands guard with
   if (global.io) so this is safe.
========================================
*/
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

global.io = io;

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
    let totalLoaded = 0;

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
                totalLoaded++;
            } catch (error) {
                console.error(`❌ Failed to load command file: ${filePath}`);
                console.error(error);
            }
        }
    }

    console.log(`✅ Loaded ${totalLoaded} command(s) across ${commandFolders.length} folder(s).`);
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
            input.channel.sendTyping().catch(() => null);
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
    /* ── Slash Commands ── */

    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) {
            await runCommand(command, interaction, null, true);
        }
        return;
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

    /* ── Bot mention: react only on pure @mention (no other text), AI reply on mention with text ── */
    if (message.mentions.has(client.user) && !message.mentions.everyone) {
        const botMentionRegex = new RegExp(`<@!?${client.user.id}>`);
        const strippedContent = message.content.replace(botMentionRegex, '').trim();

        if (!strippedContent && !message.reference) {
            // Pure @mention with no text — just react
            await message.react('<:hello:1488633282462744767>').catch(() => null);
        } else if (strippedContent) {
            // @mention with text — AI response
            try {
                const { askFootball } = require('./utils/footballAI');
                message.channel.sendTyping().catch(() => null);
                const answer = await askFootball(strippedContent, message.guild.id);
                if (answer) {
                    await message.reply(answer);
                }
            } catch (error) {
                console.error('[footballAI] mention error:', error);
            }
        }
    }

    /* ── Reply to bot message — AI response ── */
    if (message.reference && !message.mentions.has(client.user)) {
        try {
            const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (referencedMsg && referencedMsg.author.id === client.user.id) {
                const { askFootball } = require('./utils/footballAI');
                message.channel.sendTyping().catch(() => null);
                const answer = await askFootball(message.content, message.guild.id);
                if (answer) {
                    await message.reply(answer);
                }
            }
        } catch (error) {
            console.error('[footballAI] reply error:', error);
        }
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

    /* ── Football AI: # prefix ── */
    if (message.content.startsWith('#') && message.content.length > 1) {
        const question = message.content.slice(1).trim();
        if (question) {
            try {
                const { askFootball } = require('./utils/footballAI');
                message.channel.sendTyping().catch(() => null);
                const answer = await askFootball(question, message.guild.id);
                if (answer) {
                    await message.reply(answer);
                }
            } catch (error) {
                console.error('[footballAI] error:', error);
            }
        }
        return;
    }

    if (!message.content.startsWith(prefix)) return;

    /* ── AI-only channel: block commands ── */
    try {
        const { ServerConfig } = require('./models/Tournament');
        const serverConfig = await ServerConfig.findOne({ guildId: message.guild.id }).lean();
        const aiChannels = serverConfig?.aiOnlyChannels || [];

        if (aiChannels.includes(message.channel.id)) {
            // AI-only channel — block the command, but try AI first
            const commandText = message.content.slice(prefix.length).trim();
            if (commandText) {
                try {
                    const { askFootball } = require('./utils/footballAI');
                    message.channel.sendTyping().catch(() => null);
                    const answer = await askFootball(commandText, message.guild.id);
                    if (answer) {
                        return message.reply(answer);
                    }
                } catch (error) {
                    console.error('[footballAI] ai-only channel error:', error);
                }
            }
            return;
        }
    } catch (error) {
        console.error('[setaichannel] check error:', error);
    }

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
13. LOGIN
========================================
*/
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
