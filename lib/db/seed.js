import { randomUUID } from "node:crypto";
import { hashPassword, verifyPasswordHash, MIN_PASSWORD_LENGTH } from "../auth/passwords.js";

/**
 * Idempotent seed: safe to run on every startup. Never overwrites learner
 * progress. Admin credentials come from env names only; values never logged.
 */

function seedAdmin(db, env, now) {
  const email = String(env?.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) return;

  const explicit = String(env?.ADMIN_PASSWORD || "");
  const legacy = String(env?.GRANDMASTER_UI_PASSWORD || "");
  const password = explicit.length >= MIN_PASSWORD_LENGTH ? explicit : legacy;
  if (password.length < MIN_PASSWORD_LENGTH) return;

  const existing = db.get("SELECT id, password_hash FROM users WHERE email = ?", [email]);
  if (!existing) {
    db.run(
      `INSERT INTO users
        (id, email, password_hash, role, display_name, session_version, failed_attempts, locked_until, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', NULL, 1, 0, NULL, ?, ?)`,
      [randomUUID(), email, hashPassword(password, env), now, now],
    );
    return;
  }

  if (!verifyPasswordHash(password, existing.password_hash)) {
    db.run(
      "UPDATE users SET password_hash = ?, role = 'admin', session_version = session_version + 1, updated_at = ? WHERE id = ?",
      [hashPassword(password, env), now, existing.id],
    );
    return;
  }
  db.run("UPDATE users SET role = 'admin' WHERE id = ? AND role <> 'admin'", [existing.id]);
}

const COURSE = {
  id: "course-trading-basics",
  slug: "trading-basics",
  title: "Trading Basics",
  description:
    "An educational introduction to markets, risk and order mechanics. No signals, no profit promises.",
  level: "beginner",
};

const LESSONS = [
  {
    id: "lesson-trading-basics-1",
    position: 1,
    title: "What Trading Is — and What It Is Not",
    body: [
      "Trading means exchanging financial instruments such as currencies, indices or commodities. Prices move because buyers and sellers disagree about value, and every position carries uncertainty.",
      "Trading is not a guaranteed income. Any outcome can happen: a position can lose part or all of the money committed to it. Educational material cannot remove that risk, and nobody can promise future results.",
      "This course explains concepts and vocabulary. It does not tell you what to buy or sell, and nothing here is financial advice. If you decide to trade later, use money you can afford to lose and check the rules that apply where you live.",
    ].join("\n\n"),
    video_url: null,
  },
  {
    id: "lesson-trading-basics-2",
    position: 2,
    title: "Risk Basics: Position Size and Loss Limits",
    body: [
      "Risk per trade is the amount a trader is prepared to lose if a position moves against them. Many learners define it before entering, not after, because deciding under pressure is unreliable.",
      "Position size connects that planned loss to the distance to a stop level: a wider stop usually requires a smaller position for the same risk. Leverage changes the size of the position, not the underlying uncertainty.",
      "A loss limit for the day or week is a planning tool, not a guarantee. Markets can gap, spreads can widen and execution can differ from expectations. Risk management reduces some exposures; it does not eliminate them.",
    ].join("\n\n"),
    video_url: null,
  },
  {
    id: "lesson-trading-basics-3",
    position: 3,
    title: "How Markets, Orders and Leverage Work",
    body: [
      "A market order asks to trade at the best available price now; a limit order asks for a specific price or better. Neither guarantees a fill, and both can be affected by slippage and liquidity.",
      "Leverage is borrowed exposure. It magnifies the effect of price movement on the account, in both directions. A small move can therefore produce a large gain or a large loss relative to the money committed.",
      "Demo accounts and paper trading let learners practise order mechanics without risking real money. They are useful for process, but demo results do not predict live results because execution and psychology differ.",
    ].join("\n\n"),
    video_url: null,
  },
];

const QUIZ = {
  id: "quiz-trading-basics",
  lesson_id: "lesson-trading-basics-1",
  title: "Trading Basics Check",
  passing_score: 60,
};

const QUESTIONS = [
  {
    id: "question-basics-1",
    position: 1,
    prompt: "Which statement best describes trading?",
    options: [
      "A guaranteed way to grow savings every month",
      "Exchanging financial instruments where outcomes are uncertain and losses are possible",
      "A signal service that tells you exactly what to buy",
      "A savings account with a fixed interest rate",
    ],
    correct_index: 1,
    explanation:
      "Trading involves uncertainty. Prices can move against a position, and losses are possible. No outcome is guaranteed.",
  },
  {
    id: "question-basics-2",
    position: 2,
    prompt: "What does 'risk per trade' usually mean?",
    options: [
      "The total balance of the account",
      "The maximum amount a trader plans to lose on a single trade",
      "The broker's commission per order",
      "The number of trades opened in a day",
    ],
    correct_index: 1,
    explanation:
      "Risk per trade is a planned loss amount, decided before entering. It is a planning concept, not a guarantee that the loss will be limited.",
  },
  {
    id: "question-basics-3",
    position: 3,
    prompt: "What does leverage do?",
    options: [
      "Removes the risk of losing money",
      "Amplifies the effect of price movement in both directions",
      "Guarantees a profit if the direction is right",
      "Locks the price of an asset permanently",
    ],
    correct_index: 1,
    explanation:
      "Leverage increases exposure. Gains and losses are both magnified relative to the money committed.",
  },
  {
    id: "question-basics-4",
    position: 4,
    prompt: "Why do many learners practise on a demo account first?",
    options: [
      "Demo results guarantee live results",
      "To learn order mechanics without risking real money",
      "Because demo accounts cannot lose money",
      "Because brokers require it before any deposit",
    ],
    correct_index: 1,
    explanation:
      "A demo account is a practice environment for order mechanics and process. It does not predict live performance.",
  },
  {
    id: "question-basics-5",
    position: 5,
    prompt: "Which expectation is realistic for a beginner?",
    options: [
      "Every trade will win with the right strategy",
      "Some trades will lose, so planning for losses matters",
      "A large account removes all risk",
      "Following signals removes the need to understand risk",
    ],
    correct_index: 1,
    explanation:
      "Losses are a normal part of trading. Planning for them is more realistic than expecting a perfect win rate.",
  },
];

function seedContent(db, now) {
  db.run(
    `INSERT INTO courses (id, slug, title, description, level, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [COURSE.id, COURSE.slug, COURSE.title, COURSE.description, COURSE.level, now],
  );

  for (const lesson of LESSONS) {
    db.run(
      `INSERT INTO lessons (id, course_id, position, title, body, video_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [lesson.id, COURSE.id, lesson.position, lesson.title, lesson.body, lesson.video_url, now],
    );
  }

  db.run(
    `INSERT INTO quizzes (id, lesson_id, title, passing_score, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [QUIZ.id, QUIZ.lesson_id, QUIZ.title, QUIZ.passing_score, now],
  );

  for (const question of QUESTIONS) {
    db.run(
      `INSERT INTO questions (id, quiz_id, position, prompt, options, correct_index, explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        question.id,
        QUIZ.id,
        question.position,
        question.prompt,
        JSON.stringify(question.options),
        question.correct_index,
        question.explanation,
      ],
    );
  }
}

export async function seedDatabase(db, env = process.env) {
  const now = new Date().toISOString();
  seedContent(db, now);
  seedAdmin(db, env, now);
}

export const SEED_IDS = {
  course: COURSE.id,
  lessons: LESSONS.map((lesson) => lesson.id),
  quiz: QUIZ.id,
  questions: QUESTIONS.map((question) => question.id),
};
