/**
 * Ordered, additive migrations. Every statement must be safe to re-run on an
 * existing database; version tracking lives in schema_migrations.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: "academy core schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
        display_name TEXT,
        session_version INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'beginner',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        video_url TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (course_id, position)
      )`,
      `CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        passing_score INTEGER NOT NULL DEFAULT 60,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        options TEXT NOT NULL,
        correct_index INTEGER NOT NULL,
        explanation TEXT NOT NULL,
        UNIQUE (quiz_id, position)
      )`,
      `CREATE TABLE IF NOT EXISTS quiz_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        answers TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS progress (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (user_id, lesson_id)
      )`,
      `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id, position)`,
      `CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id, position)`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_user_quiz ON quiz_attempts(user_id, quiz_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id, created_at)`,
    ],
  },
  {
    version: 2,
    name: "sign-in tracking",
    statements: [
      `CREATE TABLE IF NOT EXISTS login_events (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at)`,
    ],
  },
];

export async function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.all("SELECT version FROM schema_migrations").map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      db.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, new Date().toISOString()],
      );
    });
  }
}
