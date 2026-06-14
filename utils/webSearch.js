/**
 * webSearch.js
 *
 * Simple free web search using DuckDuckGo HTML.
 * No API key needed. Returns top result snippets.
 * Used by footballAI.js for recent/current questions.
 */

const https = require('https');

/**
 * Search the web for a query and return top result snippets.
 *
 * @param {string} query - Search query
 * @param {number} [maxResults=3] - Max snippets to return
 * @returns {Promise<string|null>} - Snippets joined by newlines, or null
 */
function webSearch(query, maxResults = 3) {
    return new Promise((resolve) => {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        };

        const req = https.get(url, options, (res) => {
            let data = '';

            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return webSearch(res.headers.location, maxResults).then(resolve);
            }

            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const snippets = [];

                    // DDG HTML uses result__snippet class for descriptions
                    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
                    let match;

                    while ((match = snippetRegex.exec(data)) && snippets.length < maxResults) {
                        const text = match[1]
                            .replace(/<[^>]+>/g, '')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'")
                            .replace(/\s+/g, ' ')
                            .trim();

                        if (text.length > 20) {
                            snippets.push(text);
                        }
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

/**
 * Quick check if a question seems to be about recent events.
 * Used to decide whether to search the web.
 *
 * @param {string} question
 * @returns {boolean}
 */
function isRecentQuestion(question) {
    const currentYear = new Date().getFullYear();
    const lower = question.toLowerCase();

    // Year references (current year, next year, last year)
    const yearPattern = new RegExp(`(20[2-3]\\d|${currentYear}|${currentYear + 1}|${currentYear - 1})`);
    if (yearPattern.test(question)) return true;

    // Season references like 24/25, 25/26
    if (/\d{2}\/\d{2}/.test(question)) return true;

    // Recent time words
    const recentWords = [
        'latest', 'recent', 'current', 'today', 'yesterday', 'this week',
        'this month', 'this year', 'this season', 'right now', 'currently',
        'who won', 'who is winning', 'who leads', 'standings', 'table',
        'score', 'result', 'happened', 'just', 'now', 'livescore',
        'transferred', 'signed', 'bought', 'sold', 'sacked', 'fired',
        'appointed', 'hired', 'injured', 'retired', 'coming back',
        'next match', 'upcoming', 'fixture', 'schedule'
    ];

    return recentWords.some(word => lower.includes(word));
}

module.exports = { webSearch, isRecentQuestion };
