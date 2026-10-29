import React from "react";

export function Notice({ tone = "info", children, onRetry, retryLabel }) {
  if (!children) return null;
  return (
    <div className={`ac-notice ac-notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span>{children}</span>
      {onRetry && (
        <button type="button" className="ac-link-btn" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Disclaimer({ t, compact = false }) {
  return (
    <aside className={`ac-disclaimer${compact ? " compact" : ""}`}>
      <span className="ac-disclaimer-dot" aria-hidden="true" />
      <p>
        <strong>{t("disclaimerTitle")}:</strong> {t("disclaimer")}
      </p>
    </aside>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <header className="ac-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="ac-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function ProgressBar({ percent, label }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="ac-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="ac-loading" role="status">
      <span className="ac-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function CheckIcon({ done }) {
  return done ? (
    <svg className="ac-check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="ac-check muted" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ThemeToggle({ theme, onChange, t }) {
  const order = ["system", "light", "dark"];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  const labels = { system: t("themeSystem"), light: t("themeLight"), dark: t("themeDark") };
  return (
    <button
      type="button"
      className="ac-icon-btn"
      onClick={() => onChange(next)}
      title={`${t("themeLabel")}: ${labels[theme]}`}
      aria-label={`${t("themeLabel")}: ${labels[theme]}`}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
          <path d="M20 14.5A8 8 0 019.5 4a8.5 8.5 0 1010.5 10.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ) : theme === "light" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
          <rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 21h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

export function BottomNav({ tab, onNavigate, t }) {
  const items = [
    { id: "courses", label: t("navCourses"), icon: "book" },
    { id: "progress", label: t("navProgress"), icon: "chart" },
    { id: "profile", label: t("navProfile"), icon: "user" },
  ];
  return (
    <nav className="ac-bottom-nav" aria-label={t("appName")}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ac-nav-item${tab === item.id ? " active" : ""}`}
          onClick={() => onNavigate(`/academy/${item.id}`)}
          aria-current={tab === item.id ? "page" : undefined}
        >
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function NavIcon({ name }) {
  if (name === "chart") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "user") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
        <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22">
      <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M4 5.5V20.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function LegalFooter({ onNavigate, t }) {
  return (
    <footer className="ac-legal-footer">
      <button type="button" className="ac-link-btn" onClick={() => onNavigate("/privacy")}>
        {t("privacyTitle")}
      </button>
      <button type="button" className="ac-link-btn" onClick={() => onNavigate("/terms")}>
        {t("termsTitle")}
      </button>
      <button type="button" className="ac-link-btn" onClick={() => onNavigate("/support")}>
        {t("supportTitle")}
      </button>
    </footer>
  );
}

export function BackButton({ onClick, label }) {
  return (
    <button type="button" className="ac-back" onClick={onClick} aria-label={label}>
      <ArrowLeft />
      <span>{label}</span>
    </button>
  );
}
