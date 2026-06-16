/**
 * webSearch.js
 *
 * Free web search using DuckDuckGo.
 * Tries HTML endpoint first, falls back to Lite endpoint,
 * then falls back to Instant Answer API.
 * No API key needed. Returns top result snippets.
 *
 * Search triggers aggressively for real-world / football questions
 * because free AI models hallucinate current events badly.
 */

const https = require('https');

/* ── HTML entity cleaner ── */

function cleanHtml(raw) {
    return raw
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* ── DDG HTML search (primary) ── */

function searchDDGHtml(query, maxResults) {
    return new Promise((resolve) => {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity'
            }
        };

        const req = https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return searchDDGHtml(res.headers.location, maxResults).then(resolve);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const snippets = extractSnippets(data, maxResults);
                    resolve(snippets.length ? snippets.join('\n') : null);
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/* ── DDG Lite search (fallback 1) ── */

function searchDDGLite(query, maxResults) {
    return new Promise((resolve) => {
        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity'
            }
        };

        const req = https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const snippets = [];
                    const patterns = [
                        /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi,
                        /class="link-text"[^>]*>([\s\S]*?)<\/a>/gi,
                        /<a[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi
                    ];

                    for (const regex of patterns) {
                        let match;
                        regex.lastIndex = 0;
                        while ((match = regex.exec(data)) && snippets.length < maxResults) {
                            const text = cleanHtml(match[1]);
                            if (text.length > 15 && !snippets.includes(text)) {
                                snippets.push(text);
                            }
                        }
                        if (snippets.length >= maxResults) break;
                    }

                    resolve(snippets.length ? snippets.join('\n') : null);
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/* ── DDG Instant Answer API (fallback 2) ── */

function searchDDGAPI(query) {
    return new Promise((resolve) => {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const parts = [];

                    // Abstract (main answer)
                    if (json.Abstract) {
                        parts.push(json.Abstract);
                    }

                    // Related topics (up to 3)
                    if (json.RelatedTopics) {
                        for (const topic of json.RelatedTopics.slice(0, 3)) {
                            if (topic.Text) parts.push(topic.Text);
                        }
                    }

                    resolve(parts.length ? parts.join('\n') : null);
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(6000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/* ── Snippet extraction from DDG HTML ── */

function extractSnippets(html, maxResults) {
    const snippets = [];

    const patterns = [
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
        /class="result__a"[^>]*>([\s\S]*?)<\/a>/gi,
        /<td[^>]*class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
    ];

    for (const regex of patterns) {
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(html)) && snippets.length < maxResults) {
            const text = cleanHtml(match[1]);
            if (text.length > 15 && !snippets.includes(text)) {
                snippets.push(text);
            }
        }
        if (snippets.length >= maxResults) break;
    }

    return snippets;
}

/* ── Main search function with fallback chain ── */

async function webSearch(query, maxResults = 5) {
    // Try HTML endpoint first (richest results)
    let result = await searchDDGHtml(query, maxResults);
    if (result) return result;

    // Fallback to Lite endpoint
    result = await searchDDGLite(query, maxResults);
    if (result) return result;

    // Fallback to Instant Answer API (less detail but reliable)
    result = await searchDDGAPI(query);
    return result;
}

/**
 * Should we search the web for this question?
 *
 * Aggressive for real-world / football questions because free AI
 * models hallucinate current events badly. If in doubt, search.
 *
 * Skip: pure math, greetings, bot commands, greetings, very short stuff.
 */
function shouldSearchWeb(question) {
    const currentYear = new Date().getFullYear();
    const lower = question.toLowerCase();

    // Skip pure math
    if (/^[\d\s+\-*/().=%]+$/.test(question.trim())) return false;

    // Skip greetings
    const greetings = ['hi', 'hello', 'hey', 'sup', 'yo', 'hola', 'gm', 'good morning', 'good night'];
    if (greetings.includes(lower.trim())) return false;

    // Skip very short stuff
    if (question.trim().length < 4) return false;

    // Skip bot commands
    if (/^[.+!$#](\w+)/.test(question.trim())) return false;

    // ── ALWAYS SEARCH: year references ──
    const yearPattern = new RegExp(`(20[2-3]\\d|${currentYear}|${currentYear + 1}|${currentYear - 1})`);
    if (yearPattern.test(question)) return true;

    // ── ALWAYS SEARCH: season references like 24/25, 25/26 ──
    if (/\d{2}\/\d{2}/.test(question)) return true;

    // ── Time-sensitive keywords ──
    const timeSensitive = [
        'latest', 'recent', 'current', 'today', 'yesterday', 'this week',
        'this month', 'this year', 'this season', 'right now', 'currently',
        'who won', 'who is winning', 'who leads', 'score', 'result',
        'happened', 'happening', 'transferred', 'transfer', 'signed',
        'signings', 'sign', 'bought', 'sold', 'sacked', 'fired',
        'appointed', 'hired', 'injured', 'retired', 'breaking', 'news',
        'update', 'live', 'standings', 'table', 'ranking', 'going on'
    ];
    if (timeSensitive.some(word => lower.includes(word))) return true;

    // ── Football-specific triggers (these are ALWAYS time-sensitive) ──
    const footballTriggers = [
        'premier league', 'epl', 'la liga', 'serie a', 'bundesliga',
        'ligue 1', 'champions league', 'ucl', 'europa league', 'uel',
        'world cup', 'euro ', 'copa america', 'afcon', 'asian cup',
        'fa cup', 'copa del rey', 'dfb pokal', 'carabao', 'community shield',
        'super cup', 'club world cup', 'fixtures', 'matchday', 'gameweek',
        'top scorer', 'top assister', 'mvp', 'golden boot', 'ballon d',
        'player of the year', 'best player', 'goal of the',
        'next match', 'upcoming', 'schedule', 'draw', 'groups',
        'knockout', 'semi final', 'quarter final', 'final',
        'qualifiers', 'playoff', 'relegation', 'promotion',
        'transfer window', 'deadline day', 'free agent',
        'contract', 'extension', 'release clause', 'buyout',
        'loan', 'swap', 'fee', 'bid', 'offer', 'deal',
        'squad', 'roster', 'lineup', 'starting xi', 'bench',
        'manager', 'coach', 'head coach', 'sporting director',
        'sacked', 'resigned', 'stepped down', 'appointed',
        'injury', 'return', 'comeback', 'debut',
        'win streak', 'loss streak', 'unbeaten', 'clean sheet',
        'points', 'goal difference', 'possession'
    ];
    if (footballTriggers.some(word => lower.includes(word))) return true;

    // ── Named football entities (teams/players always mean current context) ──
    const footballNames = [
        'real madrid', 'barcelona', 'barca', 'atletico', 'man city',
        'man united', 'man utd', 'liverpool', 'chelsea', 'arsenal',
        'tottenham', 'spurs', 'bayern', 'dortmund', 'psg', 'inter',
        'juve', 'juventus', 'ac milan', 'milan', 'napoli', 'roma',
        'benfica', 'porto', 'sporting', 'ajax', 'celtic', 'rangers',
        'messi', 'ronaldo', 'mbappe', 'haaland', 'vinicius', 'bellingham',
        'salah', 'de bruyne', 'rodri', 'pedri', 'gavi', 'yamal',
        'saka', 'rice', 'palmer', 'wirtz', 'musiala', 'eder',
        'modric', 'kroos', 'neymar', 'suarez', 'lewandowski'
    ];
    if (footballNames.some(name => lower.includes(name))) return true;

    // ── "who/what/when/where" about real things → search ──
    if (/^(who|what|when|where|which|how many|how much) .{10,}/i.test(question)) return true;

    return false;
}

module.exports = { webSearch, shouldSearchWeb };
