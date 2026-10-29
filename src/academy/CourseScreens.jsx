import React, { useState } from "react";
import {
  BackButton,
  CheckIcon,
  Disclaimer,
  Notice,
  PageHead,
  ProgressBar,
  Spinner,
} from "./components.jsx";

export function CoursesScreen({ t, courses, loading, error, onRetry, onNavigate }) {
  return (
    <main className="ac-main">
      <PageHead title={t("coursesTitle")} subtitle={t("coursesSubtitle")} />
      <Disclaimer t={t} compact />
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}
      {!loading && !error && !courses?.length && <p className="ac-muted">{t("genericError")}</p>}
      <div className="ac-card-list">
        {(courses || []).map((course) => (
          <button
            key={course.id}
            type="button"
            className="ac-card ac-course-card"
            onClick={() => onNavigate(`/academy/courses/${course.id}`)}
          >
            <div className="ac-course-top">
              <h2>{course.title}</h2>
              <span className="ac-badge">{course.level}</span>
            </div>
            <p className="ac-muted">{course.description}</p>
            <ProgressBar percent={course.percent} label={`${course.percent}% ${t("percentComplete")}`} />
            <div className="ac-course-meta">
              <span>
                {course.completedCount}/{course.lessonCount} {t("lessons")}
              </span>
              <span className="ac-accent">
                {course.percent}% {t("percentComplete")}
              </span>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

export function CourseScreen({ t, course, loading, error, onRetry, onNavigate }) {
  return (
    <main className="ac-main">
      <BackButton onClick={() => onNavigate("/academy/courses")} label={t("coursesTitle")} />
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}
      {course && (
        <>
          <PageHead title={course.title} subtitle={course.description} />
          <ProgressBar percent={course.percent} label={`${course.percent}% ${t("percentComplete")}`} />
          <p className="ac-course-meta">
            <span>
              {course.completedCount}/{course.lessonCount} {t("lessons")}
            </span>
            <span className="ac-accent">
              {course.percent}% {t("percentComplete")}
            </span>
          </p>
          <ol className="ac-lesson-list">
            {course.lessons.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  className="ac-lesson-row"
                  onClick={() => onNavigate(`/academy/lessons/${lesson.id}`)}
                >
                  <CheckIcon done={lesson.completed} />
                  <span className="ac-lesson-main">
                    <span className="ac-lesson-title">
                      {lesson.position}. {lesson.title}
                    </span>
                    <span className="ac-muted ac-small">
                      {lesson.completed ? t("completed") : t("lesson")}
                      {lesson.quizId ? ` · ${t("quizAvailable")}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <Disclaimer t={t} compact />
        </>
      )}
    </main>
  );
}

export function LessonScreen({
  t,
  lesson,
  loading,
  error,
  onRetry,
  onNavigate,
  onComplete,
  completing,
}) {
  return (
    <main className="ac-main">
      <BackButton
        onClick={() => onNavigate(lesson?.courseId ? `/academy/courses/${lesson.courseId}` : "/academy/courses")}
        label={lesson?.courseTitle || t("coursesTitle")}
      />
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}
      {lesson && (
        <article className="ac-lesson">
          <PageHead title={lesson.title} subtitle={`${t("lesson")} ${lesson.position}`} />
          {lesson.body.split("\n\n").map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          {lesson.videoUrl && (
            <a className="ac-btn block" href={lesson.videoUrl} target="_blank" rel="noopener noreferrer">
              {t("videoLink")}
            </a>
          )}
          <Disclaimer t={t} />
          <div className="ac-action-row">
            {lesson.completed ? (
              <span className="ac-done-badge">
                <CheckIcon done /> {t("completed")}
              </span>
            ) : (
              <button type="button" className="ac-btn primary" onClick={() => onComplete(lesson.id)} disabled={completing}>
                {completing ? t("loading") : t("markComplete")}
              </button>
            )}
            {lesson.quiz && (
              <button
                type="button"
                className="ac-btn"
                onClick={() => onNavigate(`/academy/quizzes/${lesson.quiz.id}`)}
              >
                {t("quizTitle")}
              </button>
            )}
          </div>
        </article>
      )}
    </main>
  );
}

export function QuizScreen({
  t,
  quiz,
  attempts,
  loading,
  error,
  onRetry,
  onSubmit,
  submitting,
  result,
  onResetResult,
  onNavigate,
}) {
  const [answers, setAnswers] = useState({});
  const [localError, setLocalError] = useState("");

  function choose(questionId, index) {
    setAnswers((prev) => ({ ...prev, [questionId]: index }));
  }

  function submit(event) {
    event.preventDefault();
    setLocalError("");
    const missing = (quiz?.questions || []).some(
      (question) => !Number.isInteger(answers[question.id]),
    );
    if (missing) {
      setLocalError(t("answerAll"));
      return;
    }
    onSubmit(answers);
  }

  function restart() {
    setAnswers({});
    setLocalError("");
    onResetResult();
  }

  return (
    <main className="ac-main">
      <BackButton onClick={() => onNavigate("/academy/courses")} label={t("coursesTitle")} />
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}
      {quiz && !result && (
        <form onSubmit={submit} noValidate>
          <PageHead title={quiz.title} subtitle={t("quizTitle")} />
          <ol className="ac-question-list">
            {quiz.questions.map((question, index) => (
              <li key={question.id} className="ac-question">
                <p className="ac-question-prompt">
                  {t("questionOf")
                    .replace("{current}", String(index + 1))
                    .replace("{total}", String(quiz.questions.length))}
                </p>
                <h2>{question.prompt}</h2>
                <div role="radiogroup" aria-label={question.prompt} className="ac-option-list">
                  {question.options.map((option, optionIndex) => (
                    <label
                      key={optionIndex}
                      className={`ac-option${answers[question.id] === optionIndex ? " selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id] === optionIndex}
                        onChange={() => choose(question.id, optionIndex)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {localError && <Notice tone="danger">{localError}</Notice>}
          <Disclaimer t={t} />
          <button type="submit" className="ac-btn primary block" disabled={submitting}>
            {submitting ? t("loading") : t("submitAnswers")}
          </button>
        </form>
      )}

      {quiz && result && (
        <section className="ac-result">
          <PageHead title={t("quizResultTitle")} subtitle={quiz.title} />
          <div className={`ac-score-card${result.passed ? " pass" : " fail"}`}>
            <strong>
              {result.score}/{result.total}
            </strong>
            <span>
              {result.percent}% · {result.passed ? t("passed") : t("notPassed")}
            </span>
          </div>
          <ol className="ac-question-list">
            {result.results.map((entry, index) => {
              const question = quiz.questions.find((item) => item.id === entry.questionId);
              return (
                <li key={entry.questionId} className={`ac-question ${entry.correct ? "correct" : "wrong"}`}>
                  <p className="ac-question-prompt">
                    {index + 1}. {question?.prompt || entry.questionId}
                  </p>
                  <p className="ac-small">
                    <strong>{entry.correct ? t("correctAnswer") : t("yourAnswer")}:</strong>{" "}
                    {question?.options?.[entry.chosenIndex] ?? "—"}
                  </p>
                  {!entry.correct && (
                    <p className="ac-small">
                      <strong>{t("correctAnswer")}:</strong>{" "}
                      {question?.options?.[entry.correctIndex] ?? "—"}
                    </p>
                  )}
                  <p className="ac-small ac-muted">
                    <strong>{t("explanation")}:</strong> {entry.explanation}
                  </p>
                </li>
              );
            })}
          </ol>
          <Disclaimer t={t} />
          <button type="button" className="ac-btn primary block" onClick={restart}>
            {t("tryAgain")}
          </button>
        </section>
      )}

      {attempts?.length > 0 && (
        <section className="ac-attempts">
          <h2>{t("quizHistory")}</h2>
          <ul>
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                <span>
                  {attempt.score}/{attempt.total} · {attempt.percent}%
                </span>
                <span className="ac-muted ac-small">{new Date(attempt.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
