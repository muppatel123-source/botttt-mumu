/**
 * Flush and re-register all slash commands for a specific guild.
 *
 * Run:
 *   node scripts/flush-slash.js <CLIENT_ID> <BOT_TOKEN> [GUILD_ID]
 *
 * Or set CLIENT_ID and DISCORD_TOKEN in .env and run:
 *   node scripts/flush-slash.js
 *
 * This:
 * 1. Deletes ALL existing guild slash commands
 * 2. Deletes ALL existing global slash commands
 * 3. Re-registers everything fresh (guild first for instant, then global)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');

const CLIENT_ID = process.env.CLIENT_ID || process.argv[2];
const TOKEN = process.env.DISCORD_TOKEN || process.argv[3];
const GUILD_ID = process.argv[4] || '1417923875425222700';

if (!CLIENT_ID || !TOKEN) {
    console.error('');
    console.error('❌ Missing CLIENT_ID or DISCORD_TOKEN');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/flush-slash.js <CLIENT_ID> <TOKEN> [GUILD_ID]');
    console.error('');
    console.error('Or set CLIENT_ID and DISCORD_TOKEN in .env and run:');
    console.error('  node scripts/flush-slash.js');
    console.error('');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function flushAndRegister() {
    try {
        /* ── Step 1: Nuke ALL guild commands ── */
        console.log(`💣 Deleting ALL guild commands for ${GUILD_ID}...`);
        const guildCmds = await rest.get(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
        );
        console.log(`   Found ${guildCmds.length} guild commands to delete.`);
        for (const cmd of guildCmds) {
            await rest.delete(
                Routes.applicationGuildCommand(CLIENT_ID, GUILD_ID, cmd.id)
            );
            console.log(`   🗑️ Deleted guild command: ${cmd.name}`);
        }
        console.log('✅ Guild commands flushed.');

        /* ── Step 2: Nuke ALL global commands ── */
        console.log('💣 Deleting ALL global commands...');
        const globalCmds = await rest.get(
            Routes.applicationCommands(CLIENT_ID)
        );
        console.log(`   Found ${globalCmds.length} global commands to delete.`);
        for (const cmd of globalCmds) {
            await rest.delete(
                Routes.applicationCommand(CLIENT_ID, cmd.id)
            );
            console.log(`   🗑️ Deleted global command: ${cmd.name}`);
        }
        console.log('✅ Global commands flushed.');

        /* ── Step 3: Load all command files ── */
        console.log('📂 Loading command definitions...');
        const fs = require('fs');
        const path = require('path');

        const slashCommands = [];
        const commandFolders = ['tournament', 'config', 'fun', 'general', 'games', 'info', 'moderation', 'utilities'];

        for (const folder of commandFolders) {
            const folderPath = path.join(__dirname, '..', 'commands', folder);
            if (!fs.existsSync(folderPath)) continue;

            const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
            for (const file of files) {
                try {
                    const command = require(path.join(folderPath, file));
                    if (command.data && typeof command.data.toJSON === 'function') {
                        const json = command.data.toJSON();
                        slashCommands.push({
                            name: command.name,
                            json
                        });
                    }
                } catch (e) {
                    console.log(`   ⚠️ Skipped ${folder}/${file}: ${e.message}`);
                }
            }
        }

        console.log(`📋 Found ${slashCommands.length} slash commands to register.`);

        /* ── Step 4: Validate option order ── */
        let hasErrors = false;
        for (let i = 0; i < slashCommands.length; i++) {
            const cmd = slashCommands[i];
            const opts = cmd.json.options || [];
            let foundOptional = false;
            for (let j = 0; j < opts.length; j++) {
                const isRequired = opts[j].required === true;
                if (!isRequired) foundOptional = true;
                if (isRequired && foundOptional) {
                    console.error(`❌ BAD ORDER: "${cmd.name}" — required option "${opts[j].name}" after optional one.`);
                    hasErrors = true;
                }
            }
        }
        if (hasErrors) {
            console.error('⚠️ Some commands have bad option order. Registering anyway...');
        }

        /* ── Step 5: Register as guild commands (INSTANT) ── */
        console.log(`⚡ Registering ${slashCommands.length} guild commands for ${GUILD_ID}...`);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: slashCommands.map(c => c.json) }
        );
        console.log('✅ Guild commands registered! They should appear INSTANTLY.');

        /* ── Step 6: Register as global commands (slow cache) ── */
        console.log(`🌍 Registering ${slashCommands.length} global commands...`);
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: slashCommands.map(c => c.json) }
        );
        console.log('✅ Global commands registered! (may take up to 1 hour to appear everywhere)');

        console.log('\n🎉 ALL DONE! Check the server — slash commands should be there now.');

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.rawError) {
            console.error('Details:', JSON.stringify(error.rawError, null, 2));
        }
    }
}

flushAndRegister();
