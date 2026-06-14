/**
 * footballAI.js
 *
 * General Q&A AI with football focus. Fun personality, roasting, concise answers.
 * Powered by Groq (primary) with Gemini fallback.
 *
 * Features:
 *   - Answers any question (not just football)
 *   - Fun/roasting personality
 *   - 1-2 sentences (short and punchy)
 *   - Web search for recent/current questions
 *   - Bot tournament context (knows your leagues)
 *   - Non-football questions still answered normally
 *
 * Triggered by: # prefix, @bot mention, reply to bot
 */

/* ── System prompt builder ── */

function buildSystemPrompt(tournamentContext) {
    let prompt = `You are MUMU — a football-obsessed, witty, slightly savage bot who roasts people while dropping knowledge. You're like that one friend who watches too much football and never lets anyone forget it.

Rules:
1. Answer ANY question — football, bot leagues, general knowledge, whatever. You know things.
2. For multiple choice: answer with ONLY the letter (A, B, C, or D). No explanation.
3. For other questions: 1-2 sentences maximum. Be punchy, fun, lightly roast the user if the question is silly, but always give the real answer.
4. If you're not sure about something recent, say so honestly but still give your best guess.
5. NEVER refuse to answer. NEVER say "I cannot" or "I don't have access." Just answer.

Personality examples:
Q: Who won the 2022 World Cup? → Argentina, finally. Messi got his happy ending, was about time honestly 😤
Q: What is the capital of France? → Paris. The only thing French football wins these days 😂
Q: Who has the most Ballon d'Ors? → Messi with 8. Ronaldo is still crying about it 🐐
Q: What is 2+2? → 4. That's the kind of math even a defender can do 🧮`;

    if (tournamentContext) {
        prompt += `\n\n6. IMPORTANT: This bot runs football tournaments on Discord. Here's the current server context:\n${tournamentContext}\nIf someone asks about their league, team, standings, or anything about the bot's tournaments — use this info to answer.`;
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
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
        ];

        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages,
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

/* ── Bot tournament context ── */

async function buildTournamentContext(guildId) {
    try {
        const { TournamentSettings } = require('../models/Tournament');
        const { Team } = require('../models/Tournament');
        const { Player } = require('../models/Tournament');

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

    // Build context
    const tournamentContext = guildId ? await buildTournamentContext(guildId) : '';
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
