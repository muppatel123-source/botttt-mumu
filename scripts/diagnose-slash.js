/**
 * Diagnose why guild slash commands fail with "Missing Access"
 * Run: node scripts/diagnose-slash.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');

const CLIENT_ID = process.env.CLIENT_ID || process.argv[2];
const TOKEN = process.env.DISCORD_TOKEN || process.argv[3];
const GUILD_ID = process.argv[4] || '1417923875425222700';

if (!CLIENT_ID || !TOKEN) {
    console.error('Usage: node scripts/diagnose-slash.js <CLIENT_ID> <TOKEN> [GUILD_ID]');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function diagnose() {
    console.log('🔍 Running slash command diagnostics...\n');

    // 1. Verify the token works
    console.log('1️⃣ Checking token...');
    try {
        const bot = await rest.get(Routes.oauth2CurrentApplication());
        console.log(`   ✅ Token valid. Bot: ${bot.bot?.username || 'unknown'} (ID: ${bot.id})`);
        console.log(`   CLIENT_ID used: ${CLIENT_ID}`);
        console.log(`   Bot's actual ID: ${bot.id}`);
        if (bot.id !== CLIENT_ID) {
            console.error('   ❌ MISMATCH! CLIENT_ID does not match the bot token!');
            console.error('   Fix: Set CLIENT_ID to ' + bot.id);
            return;
        }
    } catch (e) {
        console.error('   ❌ Token invalid:', e.message);
        return;
    }

    // 2. Check what guilds the bot is in
    console.log('\n2️⃣ Checking bot guilds...');
    try {
        // Get current user guilds
        const user = await rest.get(Routes.user('@me'));
        console.log(`   Bot user: ${user.username}#${user.discriminator}`);
        
        // Try to get guild info
        try {
            const guild = await rest.get(Routes.guild(GUILD_ID));
            console.log(`   ✅ Guild found: ${guild.name} (${guild.id})`);
        } catch (e) {
            console.error(`   ❌ Cannot access guild ${GUILD_ID}: ${e.message}`);
            console.error('   The bot might not be in this server!');
        }
    } catch (e) {
        console.error('   ❌ Error:', e.message);
    }

    // 3. Try listing global commands
    console.log('\n3️⃣ Checking global commands...');
    try {
        const cmds = await rest.get(Routes.applicationCommands(CLIENT_ID));
        console.log(`   ✅ ${cmds.length} global commands found.`);
    } catch (e) {
        console.error('   ❌ Cannot list global commands:', e.message);
    }

    // 4. Try listing guild commands
    console.log('\n4️⃣ Checking guild commands...');
    try {
        const cmds = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
        console.log(`   ✅ ${cmds.length} guild commands found.`);
    } catch (e) {
        console.error(`   ❌ Cannot list guild commands: ${e.message} (code: ${e.code})`);
        if (e.code === 50001) {
            console.error('\n   🔧 FIXES TO TRY:');
            console.error('   a) Make sure the bot was invited with THIS exact URL:');
            console.error(`      https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=8`);
            console.error('   b) Server Settings → Integrations → MUMU Bot → Make sure "Use Application Commands" is ON');
            console.error('   c) The bot role needs Administrator or "Use Application Commands" permission');
            console.error('   d) Try disabling and re-enabling the bot in Server Settings → Integrations');
        }
    }

    // 5. Try registering a single test command
    console.log('\n5️⃣ Testing guild command registration with a dummy command...');
    try {
        await rest.post(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            {
                body: {
                    name: 'test-ping-' + Date.now(),
                    description: 'Test command - safe to ignore'
                }
            }
        );
        console.log('   ✅ Test command registered! Guild commands work!');
    } catch (e) {
        console.error(`   ❌ Test registration failed: ${e.message} (code: ${e.code})`);
        if (e.code === 50001) {
            console.error('\n   ⚠️ The bot DEFINITELY lacks the applications.commands scope in this server.');
        }
        if (e.code === 30001) {
            console.error('\n   ⚠️ Maximum number of guild commands reached (100). Need to delete old ones first.');
        }
    }

    // 6. Check bot permissions in the guild
    console.log('\n6️⃣ Checking integration permissions...');
    try {
        // Get the bot's application info
        const app = await rest.get(Routes.oauth2CurrentApplication());
        console.log(`   Bot owner ID: ${app.owner?.id || 'unknown'}`);
        console.log(`   Bot public: ${app.bot_public}`);
        console.log(`   Install URL: ${app.install_params ? JSON.stringify(app.install_params) : 'Not set'}`);
        
        if (!app.install_params || !app.install_params.scopes?.includes('applications.commands')) {
            console.error('\n   ❌ Bot application is NOT configured with applications.commands scope!');
            console.error('   Fix: Go to Discord Developer Portal → Your App → Installation → Add "applications.commands" to scopes');
        }
    } catch (e) {
        console.error('   ❌ Error:', e.message);
    }

    console.log('\n🔍 Diagnostics complete.');
}

diagnose();
