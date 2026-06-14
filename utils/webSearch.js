/**
 * webSearch.js
 *
 * Free web search using DuckDuckGo HTML.
 * No API key needed. Returns top result snippets.
 * Only searches for recent/time-sensitive questions.
 */

const https = require('https');

function webSearch(query, maxResults = 3) {
    return new Promise((resolve) => {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity'
            }
        };

        const req = https.get(url, options, (res) => {
            let data = '';

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return webSearch(res.headers.location, maxResults).then(resolve);
            }

            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const snippets = [];
                    const patterns = [
                        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
                        /class="result__a"[^>]*>([\s\S]*?)<\/a>/gi,
                        /<td[^>]*class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
                    ];

                    for (const regex of patterns) {
                        let match;
                        regex.lastIndex = 0;
                        while ((match = regex.exec(data)) && snippets.length < maxResults) {
                            const text = match[1]
                                .replace(/<[^>]+>/g, '')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'")
                                .replace(/&#x27;/g, "'")
                                .replace(/\s+/g, ' ')
                                .trim();

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

/**
 * Should we search the web for this question?
 * Only for recent/time-sensitive stuff — the AI can handle
 * general knowledge on its own.
 */
function shouldSearchWeb(question) {
    const currentYear = new Date().getFullYear();
    const lower = question.toLowerCase();

    // Skip pure math
    if (/^[\d\s+\-*/().=%]+$/.test(question.trim())) return false;

    // Skip greetings
    const greetings = ['hi', 'hello', 'hey', 'sup', 'yo', 'hola', 'gm', 'good morning', 'good night'];
    if (greetings.includes(lower.trim())) return false;

    // Year references
    const yearPattern = new RegExp(`(20[2-3]\\d|${currentYear}|${currentYear + 1}|${currentYear - 1})`);
    if (yearPattern.test(question)) return true;

    // Season references like 24/25, 25/26
    if (/\d{2}\/\d{2}/.test(question)) return true;

    // Time-sensitive keywords
    const recentWords = [
        'latest', 'recent', 'current', 'today', 'yesterday', 'this week',
        'this month', 'this year', 'this season', 'right now', 'currently',
        'who won', 'who is winning', 'who leads', 'score', 'result',
        'happened', 'transferred', 'signed', 'bought', 'sold', 'sacked',
        'fired', 'appointed', 'hired', 'injured', 'retired', 'breaking',
        'news', 'update', 'live', 'standings', 'table', 'ranking'
    ];

    return recentWords.some(word => lower.includes(word));
}

module.exports = { webSearch, shouldSearchWeb };
