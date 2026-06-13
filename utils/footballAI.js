/**
 * footballAI.js
 *
 * Lightweight football Q&A powered by Groq (Llama 3, primary)
 * with Gemini 2.0 Flash as fallback.
 *
 * Responds with ultra-short answers:
 *   - Multiple choice → just the letter (A, B, C, D)
 *   - Other questions → 1-3 words max
 *   - Non-football → NOT_FOOTBALL (silently ignored by caller)
 *
 * Triggered in index.js when a message starts with #
 */

const SYSTEM_PROMPT = `You are a football (soccer) trivia answer engine. Rules:
1. Only answer football-related questions. If not football, reply with exactly: NOT_FOOTBALL
2. For multiple choice questions: answer with ONLY the letter (A, B, C, or D). Nothing else.
3. For other questions: answer with 1-3 words maximum. No explanations, no full sentences.
4. Be accurate. If unsure, give your best guess.

Examples:
Q: Which club has won the most Champions League titles? → Real Madrid
Q: The offside rule was introduced in which year? A) 1863 B) 1883 C) 1925 D) 1990 → C
Q: Who scored the Hand of God goal? → Diego Maradona
Q: What is the capital of France? → NOT_FOOTBALL`;

/* ── Rate-limit cooldown cache ── */
const cooldowns = new Map();
const COOLDOWN_MS = 60 * 1000; // back off 1 min after a 429

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

async function askGroq(question) {
    if (!process.env.GROQ_API_KEY || isOnCooldown('groq')) return null;

    const groq = getGroqClient();
    if (!groq) return null;

    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: question }
            ],
            max_tokens: 50,
            temperature: 0.1
        });

        const text = response.choices?.[0]?.message?.content;
        return text?.trim() || null;
    } catch (error) {
        if (error.status === 429) {
            const retryMs = parseRetryMs(error.message);
            setCooldown('groq', retryMs);
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

async function askGemini(question) {
    if (!process.env.GEMINI_API_KEY || isOnCooldown('gemini')) return null;

    const model = getGeminiModel();
    if (!model) return null;

    try {
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: question }]
            }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: {
                maxOutputTokens: 50,
                temperature: 0.1
            }
        });

        const text = result.response?.text?.();
        return text?.trim() || null;
    } catch (error) {
        const msg = error.message || String(error);
        if (msg.includes('429') || msg.includes('quota')) {
            const retryMs = parseRetryMs(msg);
            setCooldown('gemini', retryMs);
        }
        console.error('[footballAI] Gemini error:', error.message || error);
        return null;
    }
}

/* ── Helpers ── */

/**
 * Parse retry delay from error message (e.g. "retry in 16.08s" → 16000ms)
 */
function parseRetryMs(msg) {
    const match = String(msg).match(/retry\s*(?:in|after)\s*([\d.]+)\s*s/i);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
    return COOLDOWN_MS;
}

/**
 * Main entry point. Tries Groq first, falls back to Gemini.
 * Respects rate-limit cooldowns to avoid spamming dead APIs.
 *
 * @param {string} question - The football question (without the # prefix)
 * @returns {string|null} - Short answer, NOT_FOOTBALL, or null if both fail
 */
async function askFootball(question) {
    if (!question || !question.trim()) return null;

    const cleanQ = question.trim();

    // Primary: Groq
    const groqAnswer = await askGroq(cleanQ);
    if (groqAnswer) return groqAnswer;

    // Fallback: Gemini
    const geminiAnswer = await askGemini(cleanQ);
    if (geminiAnswer) return geminiAnswer;

    return null;
}

module.exports = { askFootball };
