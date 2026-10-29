import React, { useState } from "react";
import { LegalFooter, Notice } from "./components.jsx";
import { statusMessage } from "./api.js";

function Field({ id, label, type = "text", value, onChange, autoComplete, hint, required = true }) {
  return (
    <label className="ac-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
      />
      {hint && <small className="ac-muted">{hint}</small>}
    </label>
  );
}

export function LandingScreen({ t, onNavigate }) {
  return (
    <main className="ac-main ac-landing">
      <section className="ac-hero">
        <p className="ac-eyebrow">{t("appName")}</p>
        <h1>{t("landingHeadline")}</h1>
        <p className="ac-muted">{t("landingBody")}</p>
        <div className="ac-cta-row">
          <button type="button" className="ac-btn primary" onClick={() => onNavigate("/academy/signup")}>
            {t("startLearning")}
          </button>
          <button type="button" className="ac-btn" onClick={() => onNavigate("/academy/login")}>
            {t("signInCta")}
          </button>
        </div>
      </section>

      <ul className="ac-feature-list">
        <li>{t("landingFeatureOne")}</li>
        <li>{t("landingFeatureTwo")}</li>
        <li>{t("landingFeatureThree")}</li>
      </ul>

      <Notice tone="info">{t("disclaimer")}</Notice>
      <LegalFooter onNavigate={onNavigate} t={t} />
    </main>
  );
}

export function LoginScreen({ t, onSignIn, onNavigate, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError(t("errorRequired"));
      return;
    }
    setBusy(true);
    try {
      await onSignIn(email.trim(), password);
    } catch (err) {
      setError(statusMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ac-main ac-auth">
      <button type="button" className="ac-back" onClick={() => onNavigate("/academy")}>
        {t("backHome")}
      </button>
      <h1>{t("signIn")}</h1>
      <p className="ac-muted">{t("welcomeBack")}</p>
      <Notice tone="success">{notice}</Notice>
      <form onSubmit={submit} noValidate>
        <Field id="login-email" label={t("email")} type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field id="login-password" label={t("password")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="ac-btn primary block" disabled={busy}>
          {busy ? t("loading") : t("signIn")}
        </button>
      </form>
      <div className="ac-auth-links">
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/academy/forgot")}>
          {t("forgotPassword")}
        </button>
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/academy/signup")}>
          {t("noAccount")} {t("signUp")}
        </button>
      </div>
      <LegalFooter onNavigate={onNavigate} t={t} />
    </main>
  );
}

export function SignupScreen({ t, onSignUp, onNavigate }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim() || !password || !confirm) {
      setError(t("errorRequired"));
      return;
    }
    if (password.length < 10) {
      setError(t("errorPasswordLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("errorMismatch"));
      return;
    }
    setBusy(true);
    try {
      const data = await onSignUp({ displayName: displayName.trim(), email: email.trim(), password });
      if (!data?.authenticated) {
        setInfo(data?.message || t("genericError"));
        setPassword("");
        setConfirm("");
      }
    } catch (err) {
      setError(statusMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ac-main ac-auth">
      <button type="button" className="ac-back" onClick={() => onNavigate("/academy")}>
        {t("backHome")}
      </button>
      <h1>{t("createAccountTitle")}</h1>
      <Notice tone="success">{info}</Notice>
      <form onSubmit={submit} noValidate>
        <Field id="signup-name" label={t("displayName")} value={displayName} onChange={setDisplayName} autoComplete="nickname" required={false} />
        <Field id="signup-email" label={t("email")} type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="signup-password"
          label={t("password")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t("passwordHint")}
        />
        <Field id="signup-confirm" label={t("confirmPassword")} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="ac-btn primary block" disabled={busy}>
          {busy ? t("loading") : t("signUpCta")}
        </button>
      </form>
      <div className="ac-auth-links">
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/academy/login")}>
          {t("haveAccount")} {t("signIn")}
        </button>
      </div>
      <LegalFooter onNavigate={onNavigate} t={t} />
    </main>
  );
}

export function ForgotScreen({ t, onForgot, onNavigate }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [devToken, setDevToken] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await onForgot(email.trim());
      setMessage(data?.message || t("resetRequestSent"));
      if (data?.devResetToken) setDevToken(data.devResetToken);
    } catch (err) {
      setMessage(statusMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ac-main ac-auth">
      <button type="button" className="ac-back" onClick={() => onNavigate("/academy/login")}>
        {t("backHome")}
      </button>
      <h1>{t("resetRequestTitle")}</h1>
      <p className="ac-muted">{t("resetRequestBody")}</p>
      <form onSubmit={submit} noValidate>
        <Field id="forgot-email" label={t("email")} type="email" value={email} onChange={setEmail} autoComplete="email" />
        {message && <Notice tone="info">{message}</Notice>}
        {devToken && (
          <Notice tone="info">
            {t("resetDevTokenLabel")} <code className="ac-token">{devToken}</code>
          </Notice>
        )}
        <button type="submit" className="ac-btn primary block" disabled={busy}>
          {busy ? t("loading") : t("resetPassword")}
        </button>
      </form>
      {devToken && (
        <button
          type="button"
          className="ac-btn block"
          onClick={() => onNavigate(`/academy/reset?token=${encodeURIComponent(devToken)}`)}
        >
          {t("resetTitle")}
        </button>
      )}
      <LegalFooter onNavigate={onNavigate} t={t} />
    </main>
  );
}

export function ResetScreen({ t, token, onReset, onNavigate }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError(t("resetMissingToken"));
      return;
    }
    if (password.length < 10) {
      setError(t("errorPasswordLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("errorMismatch"));
      return;
    }
    setBusy(true);
    try {
      await onReset(token, password);
      onNavigate("/academy/login", { notice: t("resetSuccess") });
    } catch (err) {
      setError(statusMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ac-main ac-auth">
      <button type="button" className="ac-back" onClick={() => onNavigate("/academy/login")}>
        {t("backHome")}
      </button>
      <h1>{t("resetTitle")}</h1>
      <form onSubmit={submit} noValidate>
        <Field id="reset-password" label={t("newPassword")} type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={t("passwordHint")} />
        <Field id="reset-confirm" label={t("confirmPassword")} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="ac-btn primary block" disabled={busy}>
          {busy ? t("loading") : t("resetPassword")}
        </button>
      </form>
      <LegalFooter onNavigate={onNavigate} t={t} />
    </main>
  );
}

const LEGAL_KEYS = {
  privacy: { title: "privacyTitle", body: "privacyBody" },
  terms: { title: "termsTitle", body: "termsBody" },
  support: { title: "supportTitle", body: "supportBody" },
  delete: { title: "deleteInfoTitle", body: "deleteInfoBody" },
};

export function LegalScreen({ t, kind, onNavigate }) {
  const entry = LEGAL_KEYS[kind] || LEGAL_KEYS.privacy;
  return (
    <main className="ac-main ac-legal">
      <button type="button" className="ac-back" onClick={() => onNavigate("/academy")}>
        {t("backHome")}
      </button>
      <h1>{t(entry.title)}</h1>
      <p className="ac-muted">{t("legalPlaceholder")}</p>
      <p>{t(entry.body)}</p>
      <Notice tone="info">{t("disclaimer")}</Notice>
      <div className="ac-auth-links">
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/privacy")}>
          {t("privacyTitle")}
        </button>
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/terms")}>
          {t("termsTitle")}
        </button>
        <button type="button" className="ac-link-btn" onClick={() => onNavigate("/support")}>
          {t("supportTitle")}
        </button>
      </div>
    </main>
  );
}
