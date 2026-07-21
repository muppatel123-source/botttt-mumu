/**
 * quiz.js
 *
 * AI-powered football quiz game. No hardcoded questions —
 * the AI generates every question and judges every answer.
 *
 * Flow:
 *   1. .quiz → pick difficulty
 *   2. React ✅ to join → 30s signup
 *   3. AI drops questions one by one
 *   4. First correct answer gets ✅ + 1 point
 *   5. Host says "stop" to end and see final leaderboard
 *
 * No database — in-memory session only.
 */

const { EmbedBuilder } = require('discord.js');
const { generateQuizQuestion, checkQuizAnswer } = require('../../utils/footballAI');

/* ── In-memory quiz state (one per channel) ── */
const activeQuizzes = new Map();

/* ── Leaderboard display ── */

function formatLeaderboard(scores, participants) {
    const sorted = [...scores.entries()]
        .map(([id, pts]) => ({ id, pts }))
        .sort((a, b) => b.pts - a.pts);

    if (!sorted.length) return 'No one scored yet!';

    const medals = ['🥇', '🥈', '🥉'];
    return sorted.map((entry, i) => {
        const medal = medals[i] || `**${i + 1}.**`;
        return `${medal} <@${entry.id}> — **${entry.pts}** pt${entry.pts !== 1 ? 's' : ''}`;
    }).join('\n');
}

/* ── End quiz ── */

async function endQuiz(game, channel) {
    game.active = false;
    if (game.collector) game.collector.stop('quiz_ended');
    if (game.timeout) clearTimeout(game.timeout);
    activeQuizzes.delete(channel.id);

    const sorted = [...game.scores.entries()]
        .map(([id, pts]) => ({ id, pts }))
        .sort((a, b) => b.pts - a.pts);

    let description;
    if (!sorted.length) {
        description = 'No one scored a single point 😭 Better luck next time!';
    } else {
        const medals = ['🥇', '🥈', '🥉'];
        description = sorted.map((entry, i) => {
            const medal = medals[i] || `**${i + 1}.**`;
            return `${medal} <@${entry.id}> — **${entry.pts}** pt${entry.pts !== 1 ? 's' : ''}`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Quiz Complete! 🏆')
        .setDescription(description)
        .setFooter({ text: `Hosted by <@${game.hostId}> • ${game.questionNumber} questions played` });

    await channel.send({ embeds: [embed] }).catch(() => null);
}

/* ── Ask a single question ── */

const LOADING_MESSAGES = [
    '📚 Flipping through football history books...',
    '⚽ Consulting the football gods...',
    '🔍 Scanning 150 years of football records...',
    '🏆 Digging into trophy cabinets...',
    '🌍 Searching across every continent...',
    '📖 Opening the encyclopedia of football...',
    '🎯 Crafting the perfect question...',
    '⚽ Looking for a banger of a question...',
    '🧠 Picking the brain of a football madman...',
    '🏟️ Checking the archives at Wembley...',
    '📋 Asking the commentators for a good one...',
    '🔥 Cooking up a fire question...',
    '🧐 Investigating football\'s deepest secrets...',
    '💎 Mining for football gems...',
    '🎯 Loading the next challenge...',
    '⚡ Charging up the football brain cells...',
    '🎪 Preparing your next headache...',
    '🪄 Summoning a question from the void...',
    '🎬 Next question loading... grab your popcorn',
    '🎓 Testing your football PhD...'
];

async function askNextQuestion(game, channel) {
    if (!game.active) return;

    game.questionNumber++;

    // Fun loading message
    const loadingText = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
    const loadingMsg = await channel.send(loadingText).catch(() => null);

    let question;
    let retries = 0;
    while (retries < 2) {
        question = await generateQuizQuestion(game.difficulty, game.askedQuestions);
        if (question) break;
        retries++;
    }

    if (loadingMsg) await loadingMsg.delete().catch(() => null);

    if (!question) {
        await channel.send('❌ Failed to generate a question. The AI is having a moment. Try `.quiz` again later.');
        game.active = false;
        activeQuizzes.delete(channel.id);
        return;
    }

    game.currentAnswer = question.answer;
    game.currentQuestion = question.question;
    game.askedQuestions.push(question.question);
    game.answered = false;

    // Post the question
    await channel.send(`## ⚽ Question ${game.questionNumber}\n**${question.question}**`);

    // Listen for answers
    const filter = msg => game.participants.has(msg.author.id) && !msg.author.bot;
    const collector = channel.createMessageCollector({ filter, time: 30000 });

    game.collector = collector;

    collector.on('collect', async (msg) => {
        // Host says stop
        if (msg.content.toLowerCase().trim() === 'stop' && msg.author.id === game.hostId) {
            await endQuiz(game, channel);
            return;
        }

        // Already answered
        if (game.answered) return;

        // Check answer
        const isCorrect = await checkQuizAnswer(question.answer, msg.content);
        if (isCorrect) {
            game.answered = true;

            // React with ✅
            await msg.react('✅').catch(() => null);

            // Update score
            const currentScore = game.scores.get(msg.author.id) || 0;
            game.scores.set(msg.author.id, currentScore + 1);

            // Announce
            await channel.send(`✅ <@${msg.author.id}> got it! The answer was **${question.answer}**\n\n${formatLeaderboard(game.scores, game.participants)}`);

            collector.stop('answered');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (!game.active) return;

        if (reason !== 'answered') {
            await channel.send(`⏰ Time's up! The answer was **${question.answer}**\n\n${formatLeaderboard(game.scores, game.participants)}`);
        }

        // Wait 5 seconds, then next question
        if (game.active) {
            game.timeout = setTimeout(() => askNextQuestion(game, channel), 5000);
        }
    });
}

/* ── Command ── */

module.exports = {
    name: 'quiz',
    aliases: ['trivia', 'footballquiz', 'fq'],
    cooldown: 5,
    description: 'Start an AI-powered football quiz game!',
    usage: '.quiz',

    async execute(message, args) {
        const channelId = message.channel.id;

        /* ── Stop subcommand ── */
        if (args[0]?.toLowerCase() === 'stop') {
            const game = activeQuizzes.get(channelId);
            if (!game) return message.reply('❌ No quiz is active in this channel.');
            if (game.hostId !== message.author.id) return message.reply('❌ Only the quiz host can stop it.');
            await endQuiz(game, message.channel);
            return;
        }

        /* ── Already active? ── */
        if (activeQuizzes.has(channelId)) {
            return message.reply('❌ A quiz is already running in this channel! Say **stop** to end it.');
        }

        /* ── Start setup ── */
        const setupEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('⚽ Football Quiz Setup')
            .setDescription('Choose a difficulty!\n\n🟢 **easy** — Casual fan stuff\n🟡 **moderate** — Decent knowledge needed\n🔴 **difficult** — Hardcore fans only\n🔄 **mixed** — Random mix of everything\n\nType your choice below!');

        await message.reply({ embeds: [setupEmbed] });

        // Wait for difficulty response from the host
        const diffFilter = msg =>
            msg.author.id === message.author.id &&
            ['easy', 'moderate', 'difficult', 'mixed', 'e', 'm', 'd', 'hard', 'medium'].includes(msg.content.toLowerCase().trim());

        try {
            const diffMsg = await message.channel.awaitMessages({
                filter: diffFilter,
                max: 1,
                time: 30000,
                errors: ['time']
            });

            const rawDiff = diffMsg.first().content.toLowerCase().trim();
            const diffMap = { e: 'easy', m: 'moderate', d: 'difficult', medium: 'moderate', hard: 'difficult' };
            const difficulty = diffMap[rawDiff] || rawDiff;

            if (!['easy', 'moderate', 'difficult', 'mixed'].includes(difficulty)) {
                return message.reply('❌ Invalid difficulty. Start again with `.quiz`');
            }

            // Post join message
            const joinEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(`⚽ Football Quiz — ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`)
                .setDescription(`React with ✅ to join the quiz!\n\n⏱️ Starting in **30 seconds**...\nHost: <@${message.author.id}>`)
                .setFooter({ text: 'The host can say "stop" at any time to end the quiz.' });

            const joinMsg = await message.channel.send({ embeds: [joinEmbed] });
            await joinMsg.react('✅').catch(() => null);

            // Wait 30 seconds for sign-ups
            await new Promise(resolve => setTimeout(resolve, 30000));

            // Collect reactors
            const fetchedJoinMsg = await joinMsg.fetch().catch(() => null);
            const participants = new Set();

            if (fetchedJoinMsg) {
                const reaction = fetchedJoinMsg.reactions.cache.get('✅');
                if (reaction) {
                    const users = await reaction.users.fetch().catch(() => new Map());
                    for (const [userId] of users) {
                        if (userId !== message.client.user.id) {
                            participants.add(userId);
                        }
                    }
                }
            }

            // Host is always a participant
            participants.add(message.author.id);

            if (participants.size === 0) {
                return message.reply('❌ No one joined the quiz! Try again later.');
            }

            // Initialize game state
            const game = {
                hostId: message.author.id,
                channelId,
                difficulty,
                participants,
                scores: new Map(),
                askedQuestions: [],
                questionNumber: 0,
                currentAnswer: null,
                currentQuestion: null,
                answered: false,
                active: true,
                collector: null,
                timeout: null
            };

            activeQuizzes.set(channelId, game);

            // Show player list and start
            const playerList = [...participants].map(id => `<@${id}>`).join(', ');
            const startEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎮 Quiz Starting!')
                .setDescription(`**${participants.size} player${participants.size > 1 ? 's' : ''}**: ${playerList}\n\nGet ready! First question coming up...`)
                .setFooter({ text: `Say "stop" to end • Difficulty: ${difficulty}` });

            await message.channel.send({ embeds: [startEmbed] });

            // Start first question after 3 seconds
            setTimeout(() => askNextQuestion(game, message.channel), 3000);

        } catch (error) {
            // Timed out waiting for difficulty
            if (error?.name === 'Error' && error?.message === 'time') {
                return message.reply('⏰ Quiz setup timed out. Start again with `.quiz`');
            }
            console.error('[quiz] Setup error:', error?.message || error);
        }
    }
};
