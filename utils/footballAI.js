/**
 * footballAI.js
 *
 * General Q&A AI. Chill personality, fun, helpful, lightly roasts.
 * Remembers conversation context per channel.
 * Knows the bot owner/developer.
 * Suggests correct command syntax when users mess up.
 *
 * Providers (in priority order, all free):
 *   1. OpenRouter  — free models, 100 requests/day free
 *   2. Together AI — $5 free credit on signup
 *   3. Groq        — 30 requests/min free (when quota available)
 *   4. Gemini      — 15 requests/min free (when quota available)
 *
 * All OpenAI-compatible providers use the same API format.
 * Gemini uses its own SDK.
 *
 * Triggered by: # prefix, @bot mention, reply to bot
 */

const https = require('https');

/* ── Conversation history (per channel, in-memory) ── */
const conversationHistory = new Map();
const MAX_HISTORY = 10;
const HISTORY_TTL = 10 * 60 * 1000;

function getHistory(channelId) {
    const entry = conversationHistory.get(channelId);
    if (!entry) return [];
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
    if (entry.messages.length > MAX_HISTORY) {
        entry.messages = entry.messages.slice(-MAX_HISTORY);
    }
    entry.lastActive = Date.now();
    conversationHistory.set(channelId, entry);
}

/* ── Command reference builder ── */
let commandRefCache = null;
let commandRefBuiltAt = 0;
const COMMAND_REF_TTL = 5 * 60 * 1000;

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
                } catch { /* skip */ }
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
4. If you're not sure about something, still give your best guess. You DO have access to web search results — use them when provided.
5. NEVER say "I don't have internet access", "I can't search the web", "I don't have access to current info", or ANY variation of that. You DO have web access. If web results are provided, use them. If not, answer from your training data and give your best guess.
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
Q: What about football? → Messi. The debate ended in 2022 🐐
Q: Who is winning the EPL right now? → [use web results if provided, otherwise best guess]
Q: I can't access the internet → That's a YOU problem, I can 😂`;

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

/* ── Provider cooldown system ── */
const providerCooldowns = new Map();

function isProviderOnCooldown(name) {
    const until = providerCooldowns.get(name);
    if (!until) return false;
    if (Date.now() < until) return true;
    providerCooldowns.delete(name);
    return false;
}

function setProviderCooldown(name, ms) {
    providerCooldowns.set(name, Date.now() + ms);
}

function parseRetryMs(msg) {
    const match = String(msg).match(/retry\s*(?:in|after)\s*([\d.]+)\s*s/i);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
    return 60 * 1000; // default 1 min
}

function isDailyQuotaError(msg) {
    return /PerDay|daily|limit: 0/i.test(String(msg));
}

/* ── OpenAI-compatible provider call (OpenRouter, Together, Groq API) ── */

async function callOpenAICompatible(baseUrl, apiKey, model, messages, cooldownName) {
    const cdKey = cooldownName || model;
    try {
        const payload = JSON.stringify({
            model,
            messages,
            max_tokens: 200,
            temperature: 0.7
        });

        const url = new URL(`${baseUrl}/chat/completions`);

        const result = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...(baseUrl.includes('openrouter') ? {
                        'HTTP-Referer': 'https://discord-bot.mumu',
                        'X-Title': 'MUMU Bot'
                    } : {})
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            const err = new Error(JSON.stringify(json.error || json));
                            err.response = { status: res.statusCode, data: json };
                            reject(err);
                        } else {
                            resolve(json);
                        }
                    } catch {
                        reject(new Error(`Parse error: ${data.slice(0, 200)}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
            req.write(payload);
            req.end();
        });

        return result?.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
        const status = error.response?.status;
        const msg = String(error.message || '');

        if (status === 429) {
            const cooldown = isDailyQuotaError(msg) ? 24 * 60 * 60 * 1000 : parseRetryMs(msg);
            setProviderCooldown(cdKey, cooldown);
            console.error(`[footballAI] ${cdKey} 429 — cooldown ${Math.round(cooldown / 1000)}s`);
        } else if (status === 402 || status === 403) {
            setProviderCooldown(cdKey, 24 * 60 * 60 * 1000);
            console.error(`[footballAI] ${cdKey} ${status} — 24h cooldown`);
        } else {
            console.error(`[footballAI] ${cdKey} error: ${status || msg.slice(0, 100)}`);
        }
        return null;
    }
}

/* ── Provider definitions ── */

/**
 * Try multiple free OpenRouter models until one works.
 */
async function callOpenRouterFree(models, messages) {
    for (const model of models) {
        const cdKey = `or:${model}`;
        if (isProviderOnCooldown(cdKey)) continue;

        const result = await callOpenAICompatible(
            'https://openrouter.ai/api/v1',
            process.env.OPENROUTER_API_KEY,
            model,
            messages,
            cdKey
        );

        if (result) return result;
    }
    return null;
}

const PROVIDERS = [
    {
        name: 'openrouter-free',
        active: () => !!process.env.OPENROUTER_API_KEY,
        cooldown: () => isProviderOnCooldown('openrouter-free'),
        call: (messages) => {
            const freeModels = [
                'deepseek/deepseek-chat-v3-0324:free',
                'moonshotai/kimi-k2.6:free',
                'meta-llama/llama-3.3-70b-instruct:free',
                'google/gemma-3-27b-it:free',
                'mistralai/mistral-small-3.1-24b-instruct:free'
            ];
            return callOpenRouterFree(freeModels, messages);
        }
    },
    {
        name: 'together',
        active: () => !!process.env.TOGETHER_API_KEY,
        cooldown: () => isProviderOnCooldown('together'),
        call: (messages) => callOpenAICompatible(
            'https://api.together.xyz/v1',
            process.env.TOGETHER_API_KEY,
            'meta-llama/Llama-3.3-70B-Instruct-Turbo',
            messages
        )
    },
    {
        name: 'groq',
        active: () => !!process.env.GROQ_API_KEY,
        cooldown: () => isProviderOnCooldown('groq'),
        call: async (messages) => {
            try {
                const Groq = require('groq-sdk');
                const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
                const response = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages,
                    max_tokens: 200,
                    temperature: 0.7
                });
                return response.choices?.[0]?.message?.content?.trim() || null;
            } catch (error) {
                if (error.status === 429) {
                    const msg = error.message || '';
                    const cooldown = isDailyQuotaError(msg) ? 24 * 60 * 60 * 1000 : parseRetryMs(msg);
                    setProviderCooldown('groq', cooldown);
                    console.error(`[footballAI] Groq 429 — cooldown ${Math.round(cooldown / 1000)}s`);
                } else {
                    console.error(`[footballAI] Groq error: ${error.status || error.message}`);
                }
                return null;
            }
        }
    },
    {
        name: 'gemini',
        active: () => !!process.env.GEMINI_API_KEY,
        cooldown: () => isProviderOnCooldown('gemini'),
        call: async (messages, _systemPromptUnused, systemPrompt) => {
            let geminiModel = null;
            try {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                geminiModel = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
            } catch { return null; }

            try {
                const contents = messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));

                const result = await geminiModel.generateContent({
                    contents,
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
                });

                return result.response?.text?.()?.trim() || null;
            } catch (error) {
                const msg = error.message || '';
                if (msg.includes('429') || msg.includes('quota')) {
                    const cooldown = isDailyQuotaError(msg) ? 24 * 60 * 60 * 1000 : parseRetryMs(msg);
                    setProviderCooldown('gemini', cooldown);
                    console.error(`[footballAI] Gemini 429 — cooldown ${Math.round(cooldown / 1000)}s`);
                } else {
                    console.error(`[footballAI] Gemini error: ${msg}`);
                }
                return null;
            }
        }
    }
];

/* ── Web search ── */

async function searchWebIfNeeded(question) {
    try {
        // Bust require cache for webSearch (use absolute path for reliable cache key)
        const wsPath = require.resolve('./webSearch');
        delete require.cache[wsPath];
        const { shouldSearchWeb, webSearch } = require(wsPath);
        if (!shouldSearchWeb(question)) return '';

        const results = await webSearch(question, 3);
        if (results) {
            return `\n\nWeb search results (use these to answer accurately):\n${results}`;
        }
    } catch (error) {
        console.error('[footballAI] Web search error:', error.message || error);
    }
    return '';
}

/* ── Bot tournament context ── */

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
    } catch { return ''; }
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

function isCommandHelpQuestion(question) {
    const lower = question.toLowerCase();
    if (/^[.+!$](\w+)/.test(lower)) return true;
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

async function askFootball(question, options = {}) {
    if (!question || !question.trim()) return null;

    const cleanQ = question.trim();
    const channelId = options.channelId || 'default';
    const isCommandQ = isCommandHelpQuestion(cleanQ);

    const tournamentContext = (options.guildId && isBotTournamentQuestion(cleanQ))
        ? await buildTournamentContext(options.guildId)
        : '';

    const systemPrompt = buildSystemPrompt({
        tournamentContext,
        username: options.username,
        displayName: options.displayName,
        isCommandQuestion: isCommandQ
    });

    const webContext = await searchWebIfNeeded(cleanQ);
    const fullQuestion = webContext ? `${cleanQ}${webContext}` : cleanQ;

    const history = getHistory(channelId);
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: fullQuestion }
    ];

    // Try each provider in order
    for (const provider of PROVIDERS) {
        if (!provider.active() || provider.cooldown()) continue;

        const answer = await provider.call(messages, systemPrompt, systemPrompt);
        if (answer) {
            pushHistory(channelId, 'user', cleanQ);
            pushHistory(channelId, 'assistant', answer);
            return answer;
        }
    }

    // All providers failed
    console.error('[footballAI] All providers failed or on cooldown');
    return null;
}

module.exports = { askFootball };
