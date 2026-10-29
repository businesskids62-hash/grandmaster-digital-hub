import React, { useState } from "react";
import { Disclaimer, Notice, PageHead, ProgressBar, Spinner } from "./components.jsx";
import { statusMessage } from "./api.js";

export function ProgressScreen({ t, progress, loading, error, onRetry, onNavigate }) {
  return (
    <main className="ac-main">
      <PageHead title={t("progressTitle")} subtitle={t("progressSubtitle")} />
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}
      {progress && (
        <>
          <section className="ac-summary">
            <div className="ac-summary-main">
              <strong>{progress.percent}%</strong>
              <span className="ac-muted">{t("percentComplete")}</span>
            </div>
            <div className="ac-summary-side">
              <div>
                <strong>{progress.completedLessons}/{progress.totalLessons}</strong>
                <span className="ac-muted ac-small">{t("lessonsCompleted")}</span>
              </div>
              <div>
                <strong>{progress.streakDays}</strong>
                <span className="ac-muted ac-small">{t("streakDays")}</span>
              </div>
            </div>
          </section>
          <ProgressBar percent={progress.percent} label={`${progress.percent}% ${t("percentComplete")}`} />

          <p className="ac-muted ac-small">
            {t("lastActivity")}:{" "}
            {progress.lastActivity ? new Date(progress.lastActivity).toLocaleString() : t("noActivity")}
          </p>

          <section>
            <h2>{t("coursesTitle")}</h2>
            <ul className="ac-plain-list">
              {progress.courses.map((course) => (
                <li key={course.id}>
                  <button
                    type="button"
                    className="ac-list-link"
                    onClick={() => onNavigate(`/academy/courses/${course.id}`)}
                  >
                    <span>{course.title}</span>
                    <span className="ac-muted ac-small">
                      {course.completedCount}/{course.lessonCount} · {course.percent}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>{t("recentLessons")}</h2>
            {progress.recentLessons.length === 0 ? (
              <p className="ac-muted">{t("noActivity")}</p>
            ) : (
              <ul className="ac-plain-list">
                {progress.recentLessons.map((lesson) => (
                  <li key={lesson.lessonId}>
                    <span>{lesson.title}</span>
                    <span className="ac-muted ac-small">
                      {new Date(lesson.completedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>{t("recentAttempts")}</h2>
            {progress.recentAttempts.length === 0 ? (
              <p className="ac-muted">{t("noAttempts")}</p>
            ) : (
              <ul className="ac-plain-list">
                {progress.recentAttempts.map((attempt) => (
                  <li key={attempt.id}>
                    <span>{attempt.quizTitle}</span>
                    <span className="ac-muted ac-small">
                      {attempt.score}/{attempt.total} · {attempt.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Disclaimer t={t} compact />
        </>
      )}
    </main>
  );
}

export function ProfileScreen({
  t,
  user,
  profile,
  loading,
  error,
  onRetry,
  theme,
  onTheme,
  onChangePassword,
  onDeleteAccount,
  onSignOut,
  notice,
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordInfo, setPasswordInfo] = useState("");

  const [deletePassword, setDeletePassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function submitPassword(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordInfo("");
    if (!currentPassword || !newPassword) {
      setPasswordError(t("errorRequired"));
      return;
    }
    if (newPassword.length < 10) {
      setPasswordError(t("errorPasswordLength"));
      return;
    }
    if (newPassword !== confirm) {
      setPasswordError(t("errorMismatch"));
      return;
    }
    setPasswordBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setPasswordInfo(t("passwordUpdated"));
    } catch (err) {
      setPasswordError(statusMessage(err, t));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function submitDelete(event) {
    event.preventDefault();
    setDeleteError("");
    if (!deletePassword || !understood) return;
    setDeleteBusy(true);
    try {
      await onDeleteAccount(deletePassword);
    } catch (err) {
      setDeleteError(statusMessage(err, t));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <main className="ac-main">
      <PageHead title={t("profileTitle")} subtitle={profile?.email || user?.email || ""} />
      <Notice tone="success">{notice}</Notice>
      {loading && <Spinner label={t("loading")} />}
      {error && (
        <Notice tone="danger" onRetry={onRetry} retryLabel={t("retry")}>
          {error}
        </Notice>
      )}

      <section className="ac-section">
        <h2>{t("accountSection")}</h2>
        <dl className="ac-kv">
          <div>
            <dt>{t("email")}</dt>
            <dd>{profile?.email || user?.email}</dd>
          </div>
          <div>
            <dt>{t("accountSection")}</dt>
            <dd>{profile?.role === "admin" ? t("roleAdmin") : t("roleStudent")}</dd>
          </div>
          {profile?.memberSince && (
            <div>
              <dt>{t("memberSince")}</dt>
              <dd>{new Date(profile.memberSince).toLocaleDateString()}</dd>
            </div>
          )}
          <div>
            <dt>{t("themeLabel")}</dt>
            <dd>
              <div className="ac-segmented" role="group" aria-label={t("themeLabel")}>
                {["system", "light", "dark"].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={theme === value ? "active" : ""}
                    onClick={() => onTheme(value)}
                  >
                    {t(value === "system" ? "themeSystem" : value === "light" ? "themeLight" : "themeDark")}
                  </button>
                ))}
              </div>
            </dd>
          </div>
        </dl>
        {user?.role === "admin" && (
          <a className="ac-btn block" href="/">
            {t("openCommandCenter")}
          </a>
        )}
        <button type="button" className="ac-btn block" onClick={onSignOut}>
          {t("signOut")}
        </button>
      </section>

      <section className="ac-section">
        <h2>{t("securitySection")}</h2>
        <form onSubmit={submitPassword} noValidate>
          <label className="ac-field" htmlFor="profile-current">
            <span>{t("currentPassword")}</span>
            <input
              id="profile-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="ac-field" htmlFor="profile-new">
            <span>{t("newPassword")}</span>
            <input
              id="profile-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small className="ac-muted">{t("passwordHint")}</small>
          </label>
          <label className="ac-field" htmlFor="profile-confirm">
            <span>{t("confirmPassword")}</span>
            <input
              id="profile-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {passwordError && <Notice tone="danger">{passwordError}</Notice>}
          {passwordInfo && <Notice tone="success">{passwordInfo}</Notice>}
          <button type="submit" className="ac-btn primary block" disabled={passwordBusy}>
            {passwordBusy ? t("loading") : t("updatePassword")}
          </button>
        </form>
      </section>

      <section className="ac-section ac-danger-zone">
        <h2>{t("deleteAccount")}</h2>
        <p className="ac-muted">{t("deleteWarning")}</p>
        <form onSubmit={submitDelete} noValidate>
          <label className="ac-field" htmlFor="delete-password">
            <span>{t("deletePasswordPrompt")}</span>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
          </label>
          <label className="ac-checkbox">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            <span>{t("deleteUnderstand")}</span>
          </label>
          {deleteError && <Notice tone="danger">{deleteError}</Notice>}
          <button
            type="submit"
            className="ac-btn danger block"
            disabled={deleteBusy || !deletePassword || !understood}
          >
            {deleteBusy ? t("loading") : t("deleteConfirm")}
          </button>
        </form>
      </section>

      <Disclaimer t={t} compact />
    </main>
  );
}
