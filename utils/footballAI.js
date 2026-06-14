/**
 * footballAI.js
 *
 * General Q&A AI. Normal chat personality, fun and helpful.
 * Only brings up tournament context when someone specifically asks about it.
 * Powered by Groq (primary) with Gemini fallback.
 *
 * Triggered by: # prefix, @bot mention, reply to bot
 */

/* ── System prompt builder ── */

function buildSystemPrompt(tournamentContext) {
    let prompt = `You are MUMU — a chill, witty, slightly sarcastic bot who's fun to talk to. You give short, punchy answers with a bit of personality. Think of yourself as that one friend who's helpful but can't resist a light roast.

Rules:
1. Answer ANY question — sports, tech, random facts, whatever.
2. For multiple choice: answer with ONLY the letter (A, B, C, or D). No explanation.
3. For other questions: 1-2 sentences max. Keep it snappy and fun.
4. If you're not sure about something recent, say so honestly but still give your best guess.
5. NEVER refuse to answer. NEVER say "I cannot" or "I don't have access." Just answer.
6. Don't force football into every answer. Be natural. Only bring up football if the question is actually about football.

Personality examples:
Q: Who won the 2022 World Cup? → Argentina. Messi finally got his happy ending 🐐
Q: What is the capital of France? → Paris. Lovely city, terrible traffic 🗼
Q: What is 2+2? → 4. I believe in you 🧮
Q: How do I cook rice? → 1 cup rice, 2 cups water, bring to boil, simmer 15 mins. You got this 🍚`;

    if (tournamentContext) {
        prompt += `\n\nYou also help run a football tournament bot on this Discord server. Here's what's currently active:\n${tournamentContext}\nOnly mention this if someone asks about their league, tournament, team, standings, or anything bot-related.`;
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

async function askGroq(question, systemPrompt) {
    if (!process.env.GROQ_API_KEY || isOnCooldown('groq')) return null;

    const groq = getGroqClient();
    if (!groq) return null;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: question }
            ],
            max_tokens: 150,
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

async function askGemini(question, systemPrompt) {
    if (!process.env.GEMINI_API_KEY || isOnCooldown('gemini')) return null;

    const model = getGeminiModel();
    if (!model) return null;

    try {
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: question }]
            }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                maxOutputTokens: 150,
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

/**
 * Check if the question seems related to the bot's tournaments.
 * Only then do we load tournament context.
 */
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

/* ── Main entry point ── */

/**
 * Ask the AI a question.
 *
 * @param {string} question - The question (without # prefix)
 * @param {string} [guildId] - Guild ID for tournament context
 * @returns {Promise<string|null>} - Answer or null if both providers fail
 */
async function askFootball(question, guildId) {
    if (!question || !question.trim()) return null;

    const cleanQ = question.trim();

    // Only load tournament context if the question seems related
    const tournamentContext = (guildId && isBotTournamentQuestion(cleanQ))
        ? await buildTournamentContext(guildId)
        : '';

    const systemPrompt = buildSystemPrompt(tournamentContext);

    // Search web for recent questions
    const webContext = await searchWebIfNeeded(cleanQ);
    const fullQuestion = webContext ? `${cleanQ}${webContext}` : cleanQ;

    // Try Groq first
    const groqAnswer = await askGroq(fullQuestion, systemPrompt);
    if (groqAnswer) return groqAnswer;

    // Fallback to Gemini
    const geminiAnswer = await askGemini(fullQuestion, systemPrompt);
    if (geminiAnswer) return geminiAnswer;

    return null;
}

module.exports = { askFootball };
