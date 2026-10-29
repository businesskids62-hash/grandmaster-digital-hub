import { randomUUID } from "node:crypto";
import { writeAudit } from "../auth/audit.js";

function dateKey(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

function percent(completed, total) {
  if (!total) return 0;
  return Math.round((completed / total) * 100);
}

export function listCourses(db, userId) {
  const rows = db.all(
    `SELECT c.id, c.slug, c.title, c.description, c.level,
       (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
       (SELECT COUNT(*) FROM progress p
          JOIN lessons l2 ON l2.id = p.lesson_id
         WHERE l2.course_id = c.id AND p.user_id = ?) AS completed_count
     FROM courses c
     ORDER BY c.created_at ASC, c.title ASC`,
    [userId || ""],
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    level: row.level,
    lessonCount: Number(row.lesson_count),
    completedCount: Number(row.completed_count),
    percent: percent(Number(row.completed_count), Number(row.lesson_count)),
  }));
}

export function getCourse(db, idOrSlug, userId) {
  const course = db.get(
    "SELECT id, slug, title, description, level FROM courses WHERE id = ? OR slug = ?",
    [idOrSlug, idOrSlug],
  );
  if (!course) return null;

  const lessons = db.all(
    `SELECT l.id, l.position, l.title,
       CASE WHEN p.lesson_id IS NULL THEN 0 ELSE 1 END AS completed,
       p.completed_at,
       (SELECT q.id FROM quizzes q WHERE q.lesson_id = l.id LIMIT 1) AS quiz_id
     FROM lessons l
     LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
     WHERE l.course_id = ?
     ORDER BY l.position ASC`,
    [userId || "", course.id],
  );

  const completedCount = lessons.filter((lesson) => Number(lesson.completed) === 1).length;
  return {
    ...course,
    lessonCount: lessons.length,
    completedCount,
    percent: percent(completedCount, lessons.length),
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      position: Number(lesson.position),
      title: lesson.title,
      completed: Number(lesson.completed) === 1,
      completedAt: lesson.completed_at || null,
      quizId: lesson.quiz_id || null,
    })),
  };
}

export function getLesson(db, lessonId, userId) {
  const lesson = db.get(
    `SELECT l.id, l.course_id, l.position, l.title, l.body, l.video_url,
       c.slug AS course_slug, c.title AS course_title
     FROM lessons l
     JOIN courses c ON c.id = l.course_id
     WHERE l.id = ?`,
    [lessonId],
  );
  if (!lesson) return null;

  const completed = db.get(
    "SELECT completed_at FROM progress WHERE user_id = ? AND lesson_id = ?",
    [userId || "", lessonId],
  );
  const quiz = db.get(
    "SELECT id, title, passing_score FROM quizzes WHERE lesson_id = ? LIMIT 1",
    [lessonId],
  );

  return {
    id: lesson.id,
    courseId: lesson.course_id,
    courseSlug: lesson.course_slug,
    courseTitle: lesson.course_title,
    position: Number(lesson.position),
    title: lesson.title,
    body: lesson.body,
    videoUrl: lesson.video_url || null,
    completed: Boolean(completed),
    completedAt: completed?.completed_at || null,
    quiz: quiz
      ? {
          id: quiz.id,
          title: quiz.title,
          passingScore: Number(quiz.passing_score),
          questionCount: Number(
            db.get("SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?", [quiz.id]).count,
          ),
        }
      : null,
  };
}

export function completeLesson(db, userId, lessonId) {
  const lesson = db.get("SELECT id FROM lessons WHERE id = ?", [lessonId]);
  if (!lesson) return null;

  const stamp = new Date().toISOString();
  db.run(
    "INSERT INTO progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?) ON CONFLICT (user_id, lesson_id) DO NOTHING",
    [userId, lessonId, stamp],
  );
  const row = db.get(
    "SELECT completed_at FROM progress WHERE user_id = ? AND lesson_id = ?",
    [userId, lessonId],
  );
  writeAudit(db, { userId, action: "lesson_complete", detail: { lessonId } });
  return { lessonId, completed: true, completedAt: row.completed_at };
}

export function getQuizForClient(db, quizId) {
  const quiz = db.get("SELECT id, lesson_id, title, passing_score FROM quizzes WHERE id = ?", [
    quizId,
  ]);
  if (!quiz) return null;

  const questions = db.all(
    "SELECT id, position, prompt, options FROM questions WHERE quiz_id = ? ORDER BY position ASC",
    [quizId],
  );
  return {
    id: quiz.id,
    lessonId: quiz.lesson_id,
    title: quiz.title,
    passingScore: Number(quiz.passing_score),
    questions: questions.map((question) => ({
      id: question.id,
      position: Number(question.position),
      prompt: question.prompt,
      options: JSON.parse(question.options),
    })),
  };
}

export function submitQuizAttempt(db, userId, quizId, answers) {
  const quiz = db.get("SELECT id, passing_score FROM quizzes WHERE id = ?", [quizId]);
  if (!quiz) return null;
  const questions = db.all(
    "SELECT id, correct_index, explanation FROM questions WHERE quiz_id = ? ORDER BY position ASC",
    [quizId],
  );
  if (!questions.length) return null;

  const submitted = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const results = [];
  let score = 0;

  for (const question of questions) {
    const raw = submitted[question.id];
    const chosen =
      Number.isInteger(raw) && raw >= 0 && raw <= 9 ? raw : null;
    const correct = chosen !== null && chosen === Number(question.correct_index);
    if (correct) score += 1;
    results.push({
      questionId: question.id,
      correct,
      chosenIndex: chosen,
      correctIndex: Number(question.correct_index),
      explanation: question.explanation,
    });
  }

  const total = questions.length;
  const percentScore = percent(score, total);
  const attempt = {
    id: randomUUID(),
    score,
    total,
    percent: percentScore,
    passingScore: Number(quiz.passing_score),
    passed: percentScore >= Number(quiz.passing_score),
    results,
    createdAt: new Date().toISOString(),
  };

  db.run(
    "INSERT INTO quiz_attempts (id, user_id, quiz_id, score, total, answers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      attempt.id,
      userId,
      quizId,
      score,
      total,
      JSON.stringify({ answers: submitted, results }),
      attempt.createdAt,
    ],
  );
  writeAudit(db, { userId, action: "quiz_attempt", detail: { quizId, score, total } });
  return attempt;
}

export function listAttempts(db, userId, quizId) {
  const rows = db.all(
    `SELECT id, score, total, created_at FROM quiz_attempts
     WHERE user_id = ? AND quiz_id = ?
     ORDER BY created_at DESC LIMIT 20`,
    [userId, quizId],
  );
  return rows.map((row) => ({
    id: row.id,
    score: Number(row.score),
    total: Number(row.total),
    percent: percent(Number(row.score), Number(row.total)),
    createdAt: row.created_at,
  }));
}

function computeStreak(activityDays, now = new Date()) {
  if (!activityDays.size) return 0;
  const cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const today = cursor.toISOString().slice(0, 10);
  if (!activityDays.has(today)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!activityDays.has(cursor.toISOString().slice(0, 10))) return 0;
  }
  let streak = 0;
  while (activityDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function getProgress(db, userId, now = new Date()) {
  const courses = listCourses(db, userId);
  const lessons = db.all(
    `SELECT p.lesson_id, p.completed_at, l.title, l.course_id, c.title AS course_title
     FROM progress p
     JOIN lessons l ON l.id = p.lesson_id
     JOIN courses c ON c.id = l.course_id
     WHERE p.user_id = ?
     ORDER BY p.completed_at DESC`,
    [userId],
  );
  const attempts = db.all(
    `SELECT a.id, a.quiz_id, a.score, a.total, a.created_at, q.title
     FROM quiz_attempts a
     JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC LIMIT 20`,
    [userId],
  );

  const activityDays = new Set();
  for (const row of db.all(
    `SELECT completed_at AS ts FROM progress WHERE user_id = ?
     UNION ALL
     SELECT created_at AS ts FROM quiz_attempts WHERE user_id = ?`,
    [userId, userId],
  )) {
    const key = dateKey(row.ts);
    if (key) activityDays.add(key);
  }

  const timestamps = [
    ...lessons.map((lesson) => lesson.completed_at),
    ...attempts.map((attempt) => attempt.created_at),
  ].filter(Boolean);
  const lastActivity = timestamps.sort().at(-1) || null;

  const totalLessons = courses.reduce((sum, course) => sum + course.lessonCount, 0);
  const completedLessons = courses.reduce((sum, course) => sum + course.completedCount, 0);

  return {
    percent: percent(completedLessons, totalLessons),
    completedLessons,
    totalLessons,
    streakDays: computeStreak(activityDays, now),
    lastActivity,
    courses,
    recentLessons: lessons.slice(0, 10).map((lesson) => ({
      lessonId: lesson.lesson_id,
      title: lesson.title,
      courseId: lesson.course_id,
      courseTitle: lesson.course_title,
      completedAt: lesson.completed_at,
    })),
    recentAttempts: attempts.map((attempt) => ({
      id: attempt.id,
      quizId: attempt.quiz_id,
      quizTitle: attempt.title,
      score: Number(attempt.score),
      total: Number(attempt.total),
      percent: percent(Number(attempt.score), Number(attempt.total)),
      createdAt: attempt.created_at,
    })),
  };
}

export function getProfile(db, userId) {
  const user = db.get(
    "SELECT id, email, role, display_name, created_at FROM users WHERE id = ?",
    [userId],
  );
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name || null,
    memberSince: user.created_at,
  };
}
