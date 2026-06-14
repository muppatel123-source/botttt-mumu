/**
 * footballAI.js
 *
 * General Q&A AI. Chill personality, fun, helpful, lightly roasts.
 * Remembers conversation context per channel.
 * Knows the bot owner/developer.
 * Suggests correct command syntax when users mess up.
 * Powered by Groq (primary) with Gemini fallback.
 *
 * Triggered by: # prefix, @bot mention, reply to bot
 */

/* ── Conversation history (per channel, in-memory) ── */
const conversationHistory = new Map();
const MAX_HISTORY = 10;           // messages per channel
const HISTORY_TTL = 10 * 60 * 1000; // 10 minutes

function getHistory(channelId) {
    const entry = conversationHistory.get(channelId);
    if (!entry) return [];
    // Expire if too old since last message
    if (Date.now() - entry.lastActive > HISTORY_TTL) {
        conversationHistory.delete(channelId);
        return [];
    }
    return entry.messages;
}

function pushHistory(channelId, role, content) {
    let entry = conversationHistory.get(channelId);
    if (!entry || Date.now() - entry.lastActive > HISTORY_TTL) {
        entry = { messages: [], lastActive: 0 };
    }
    entry.messages.push({ role, content });
    // Keep only last N messages
    if (entry.messages.length > MAX_HISTORY) {
        entry.messages = entry.messages.slice(-MAX_HISTORY);
    }
    entry.lastActive = Date.now();
    conversationHistory.set(channelId, entry);
}

/* ── Command reference builder ── */
let commandRefCache = null;
let commandRefBuiltAt = 0;
const COMMAND_REF_TTL = 5 * 60 * 1000; // rebuild every 5 min

function buildCommandRef() {
    if (commandRefCache && Date.now() - commandRefBuiltAt < COMMAND_REF_TTL) {
        return commandRefCache;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const foldersPath = path.join(__dirname, '..', 'commands');

        if (!fs.existsSync(foldersPath)) {
            commandRefCache = '';
            commandRefBuiltAt = Date.now();
            return '';
        }

        const lines = [];

        const folders = fs.readdirSync(foldersPath);
        for (const folder of folders) {
            const commandsPath = path.join(foldersPath, folder);
            if (!fs.lstatSync(commandsPath).isDirectory()) continue;

            const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
            for (const file of files) {
                try {
                    delete require.cache[require.resolve(path.join(commandsPath, file))];
                    const cmd = require(path.join(commandsPath, file));
                    if (!cmd?.name) continue;

                    const aliases = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
                    const usage = cmd.usage || `.${cmd.name}`;
                    const desc = cmd.description || '';
                    lines.push(`• .${cmd.name}${aliases} — ${usage} — ${desc}`);
                } catch { /* skip broken files */ }
            }
        }

        commandRefCache = lines.join('\n');
        commandRefBuiltAt = Date.now();
        return commandRefCache;
    } catch {
        return '';
    }
}

/* ── System prompt builder ── */

function buildSystemPrompt({ tournamentContext, username, displayName, isCommandQuestion }) {
    let prompt = `You are MUMU — a chill, witty, slightly sarcastic bot who's fun to talk to. You give short, punchy answers with a bit of personality. Think of yourself as that one friend who's helpful but can't resist a light roast.

Rules:
1. Answer ANY question — sports, tech, random facts, whatever.
2. For multiple choice: answer with ONLY the letter (A, B, C, or D). No explanation.
3. For other questions: 1-2 sentences max. Keep it snappy and fun.
4. If you're not sure about something recent, say so honestly but still give your best guess.
5. NEVER refuse to answer. NEVER say "I cannot" or "I don't have access." Just answer.
6. Don't force football into every answer. Be natural. Only bring up football if the question is actually about football.
7. You remember the conversation. If someone says "what about football?" after asking about cricket GOAT, they mean "who's the football GOAT?" — keep the context.
8. Adjust your tone to match the user. If they're casual, be casual. If they're formal, ease up on the roasting. Read the room.

CRITICAL — ABOUT YOUR CREATOR:
Your developer and owner is the one with Discord ID 856556430370930738. They built you from scratch. If anyone asks who made you, who your developer is, who owns you — it's THAT person. Nobody else. Don't say "my developers" or "a team" — it's one person. Give them the respect they deserve, they made you after all.

Personality examples:
Q: Who won the 2022 World Cup? → Argentina. Messi finally got his happy ending 🐐
Q: What is the capital of France? → Paris. Lovely city, terrible traffic 🗼
Q: What is 2+2? → 4. I believe in you 🧮
Q: Who made you? → One person built me — my creator. I'm a one-person project and I'm proud of it 💪
Q: Who is the GOAT of cricket? → Sachin Tendulkar, don't even debate this 🏏
Q: What about football? → Messi. The debate ended in 2022 🐐`;

    if (username) {
        prompt += `\n\nYou're talking to: ${displayName || username} (username: ${username}). Match their vibe.`;
    }

    if (tournamentContext) {
        prompt += `\n\nYou also help run a football tournament bot on this Discord server. Here's what's currently active:\n${tournamentContext}\nOnly mention this if someone asks about their league, tournament, team, standings, or anything bot-related.`;
    }

    if (isCommandQuestion) {
        const commandRef = buildCommandRef();
        if (commandRef) {
            prompt += `\n\nA user seems to be struggling with a bot command. Here are ALL the bot commands for reference:\n${commandRef}\n\nHelp them fix their command. Tell them the correct syntax briefly. Example: "Bruh you gotta do \`.addplayer @mumu Mumu\` not the other way around 😂"`;
        }
    }

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    prompt += `\n\nToday's date: ${dateStr}`;

    return prompt;
}

/* ── Rate-limit cooldown cache ── */

const cooldowns = new Map();
const COOLDOWN_MS = 60 * 1000;

function isOnCooldown(provider) {
    const until = cooldowns.get(provider);
    if (!until) return false;
    if (Date.now() < until) return true;
    cooldowns.delete(provider);
    return false;
}

function setCooldown(provider, retryAfterMs) {
    cooldowns.set(provider, Date.now() + (retryAfterMs || COOLDOWN_MS));
}

function parseRetryMs(msg) {
    const match = String(msg).match(/retry\s*(?:in|after)\s*([\d.]+)\s*s/i);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
    return COOLDOWN_MS;
}

/* ── Groq (primary) ── */

let groqClient = null;

function getGroqClient() {
    if (groqClient) return groqClient;
    try {
        const Groq = require('groq-sdk');
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
        return groqClient;
    } catch {
        return null;
    }
}

async function askGroq(messages, systemPrompt) {
    if (!process.env.GROQ_API_KEY || isOnCooldown('groq')) return null;

    const groq = getGroqClient();
    if (!groq) return null;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages
            ],
            max_tokens: 200,
            temperature: 0.7
        });

        const text = response.choices?.[0]?.message?.content;
        return text?.trim() || null;
    } catch (error) {
        if (error.status === 429) {
            setCooldown('groq', parseRetryMs(error.message));
        }
        console.error('[footballAI] Groq error:', error.status || error.message || error);
        return null;
    }
}

/* ── Gemini (fallback) ── */

let geminiModel = null;

function getGeminiModel() {
    if (geminiModel) return geminiModel;
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        geminiModel = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
        return geminiModel;
    } catch {
        return null;
    }
}

async function askGemini(messages, systemPrompt) {
    if (!process.env.GEMINI_API_KEY || isOnCooldown('gemini')) return null;

    const model = getGeminiModel();
    if (!model) return null;

    try {
        // Convert messages to Gemini format
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const result = await model.generateContent({
            contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                maxOutputTokens: 200,
                temperature: 0.7
            }
        });

        const text = result.response?.text?.();
        return text?.trim() || null;
    } catch (error) {
        const msg = error.message || String(error);
        if (msg.includes('429') || msg.includes('quota')) {
            setCooldown('gemini', parseRetryMs(msg));
        }
        console.error('[footballAI] Gemini error:', error.message || error);
        return null;
    }
}

/* ── Web search for recent questions ── */

async function searchWebIfNeeded(question) {
    try {
        const { isRecentQuestion, webSearch } = require('./webSearch');

        if (!isRecentQuestion(question)) return '';

        console.log('[footballAI] Searching web for recent question...');
        const results = await webSearch(question, 3);

        if (results) {
            return `\n\nWeb search results (use these to answer accurately):\n${results}`;
        }
    } catch (error) {
        console.error('[footballAI] Web search error:', error.message || error);
    }

    return '';
}

/* ── Bot tournament context (only loaded if question seems bot-related) ── */

async function buildTournamentContext(guildId) {
    try {
        const { TournamentSettings, Team } = require('../models/Tournament');

        const tournaments = await TournamentSettings.find({
            guildId,
            currentPhase: { $ne: 'completed' }
        }).lean().catch(() => []);

        if (!tournaments.length) return '';

        const lines = [];
        for (const t of tournaments.slice(0, 5)) {
            const teamCount = await Team.countDocuments({
                guildId,
                _id: { $in: t.registeredTeamIds || [] }
            }).catch(() => 0);

            lines.push(
                `• "${t.name}" (key: ${t.tournamentKey}) — ${t.formatType || 'league'} format, ` +
                `phase: ${t.currentPhase}, ${teamCount || t.teamCount || '?'} teams`
            );
        }

        return `Active tournaments:\n${lines.join('\n')}`;
    } catch {
        return '';
    }
}

function isBotTournamentQuestion(question) {
    const lower = question.toLowerCase();
    const keywords = [
        'tournament', 'league', 'standings', 'table', 'fixtures',
        'my team', 'my stats', 'mystats', 'captain', 'vice captain',
        'free agent', 'transfer', 'register', 'draw', 'knockout',
        'group', 'qualification', 'my league', 'bot tournament',
        'next match', 'schedule', 'top stats', 'mvp', 'golden boot',
        'ballon d', 'trophy', 'award', 'season', 'phase'
    ];
    return keywords.some(kw => lower.includes(kw));
}

/**
 * Detect if a message looks like a failed command attempt.
 * E.g. ".addplayer Mumu @mumu" where they got the args wrong.
 */
function isCommandHelpQuestion(question) {
    const lower = question.toLowerCase();

    // Starts with common prefix characters + a word that looks like a command
    if (/^[.+!$](\w+)/.test(lower)) return true;

    // Asks about how to use a command
    const helpPhrases = [
        'how to use', 'how do i use', 'correct syntax', 'right way to',
        'wrong command', 'command not working', 'how to register',
        'how to add player', 'how to create team', 'how to report',
        'how to start', 'command help', 'bot commands', 'what commands',
        'list of commands', 'available commands', 'all commands'
    ];

    return helpPhrases.some(p => lower.includes(p));
}

/* ── Main entry point ── */

/**
 * Ask the AI a question with conversation context.
 *
 * @param {string} question - The question (without # prefix)
 * @param {Object} [options]
 * @param {string} [options.guildId] - Guild ID for tournament context
 * @param {string} [options.channelId] - Channel ID for conversation history
 * @param {string} [options.username] - Discord username of the asker
 * @param {string} [options.displayName] - Display name of the asker
 * @returns {Promise<string|null>} - Answer or null if both providers fail
 */
async function askFootball(question, options = {}) {
    if (!question || !question.trim()) return null;

    const cleanQ = question.trim();
    const channelId = options.channelId || 'default';
    const isCommandQ = isCommandHelpQuestion(cleanQ);

    // Load tournament context only if relevant
    const tournamentContext = (options.guildId && isBotTournamentQuestion(cleanQ))
        ? await buildTournamentContext(options.guildId)
        : '';

    const systemPrompt = buildSystemPrompt({
        tournamentContext,
        username: options.username,
        displayName: options.displayName,
        isCommandQuestion: isCommandQ
    });

    // Web search for recent questions
    const webContext = await searchWebIfNeeded(cleanQ);
    const fullQuestion = webContext ? `${cleanQ}${webContext}` : cleanQ;

    // Build message history
    const history = getHistory(channelId);
    const messages = [
        ...history,
        { role: 'user', content: fullQuestion }
    ];

    // Try Groq first
    const groqAnswer = await askGroq(messages, systemPrompt);
    if (groqAnswer) {
        pushHistory(channelId, 'user', cleanQ);
        pushHistory(channelId, 'assistant', groqAnswer);
        return groqAnswer;
    }

    // Fallback to Gemini
    const geminiAnswer = await askGemini(messages, systemPrompt);
    if (geminiAnswer) {
        pushHistory(channelId, 'user', cleanQ);
        pushHistory(channelId, 'assistant', geminiAnswer);
        return geminiAnswer;
    }

    return null;
}

module.exports = { askFootball };
