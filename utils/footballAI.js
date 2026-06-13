/**
 * footballAI.js
 *
 * Lightweight football Q&A powered by Gemini 2.0 Flash (primary)
 * with Groq (Llama 3) as fallback.
 *
 * Responds with ultra-short answers:
 *   - Multiple choice → just the letter (A, B, C, D)
 *   - Other questions → 1-3 words max
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

let geminiModel = null;

/**
 * Lazy-init the Gemini model on first call.
 */
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

/**
 * Ask Gemini 2.0 Flash.
 */
async function askGemini(question) {
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
        console.error('[footballAI] Gemini error:', error.message || error);
        return null;
    }
}

/**
 * Ask Groq (Llama 3) as fallback.
 */
async function askGroq(question) {
    try {
        const Groq = require('groq-sdk');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
        console.error('[footballAI] Groq error:', error.message || error);
        return null;
    }
}

/**
 * Main entry point. Tries Gemini first, falls back to Groq.
 *
 * @param {string} question - The football question (without the # prefix)
 * @returns {string|null} - Short answer or null if both fail
 */
async function askFootball(question) {
    if (!question || !question.trim()) return null;

    const cleanQ = question.trim();

    // Try Gemini first
    const geminiAnswer = await askGemini(cleanQ);
    if (geminiAnswer) return geminiAnswer;

    // Fallback to Groq
    const groqAnswer = await askGroq(cleanQ);
    if (groqAnswer) return groqAnswer;

    return null;
}

module.exports = { askFootball };
