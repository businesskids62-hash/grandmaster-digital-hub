import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, statusMessage } from "./api.js";
import { t } from "./strings.js";
import { BottomNav, Notice, Spinner, ThemeToggle } from "./components.jsx";
import {
  ForgotScreen,
  LandingScreen,
  LegalScreen,
  LoginScreen,
  ResetScreen,
  SignupScreen,
} from "./AuthScreens.jsx";
import { CourseScreen, CoursesScreen, LessonScreen, QuizScreen } from "./CourseScreens.jsx";
import { ProfileScreen, ProgressScreen } from "./AccountScreens.jsx";
import { useSeo } from "../seo.js";
import "./academy.css";

const THEME_KEY = "gm_academy_theme";

function currentPath() {
  if (typeof window === "undefined") return "/academy";
  return window.location.pathname.replace(/\/+$/, "") || "/academy";
}

function parsePath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second, third] = parts;
  if (first === "privacy" || first === "terms" || first === "support") {
    return { name: first };
  }
  if (first !== "academy") return { name: "landing" };
  if (!second) return { name: "home" };
  if (["login", "signup", "forgot", "reset"].includes(second)) return { name: second };
  if (second === "courses") return third ? { name: "course", id: third } : { name: "courses" };
  if (second === "lessons" && third) return { name: "lesson", id: third };
  if (second === "quizzes" && third) return { name: "quiz", id: third };
  if (second === "progress" || second === "profile") return { name: second };
  return { name: "home" };
}

const PUBLIC_SEO = {
  landing: {
    title: "Grandmaster Academy | Learn Trading Basics Safely",
    description:
      "Learn how markets, risk and orders work with short education-only lessons. No signals, no trade calls and no profit promises.",
    path: "/academy",
  },
  login: {
    title: "Sign In | Grandmaster Academy",
    description:
      "Sign in to Grandmaster Academy to continue your lessons, quizzes and saved progress.",
    path: "/academy/login",
  },
  signup: {
    title: "Create a Free Account | Grandmaster Academy",
    description:
      "Create a free Grandmaster Academy account to track lessons, quiz attempts and learning progress.",
    path: "/academy/signup",
  },
  forgot: {
    title: "Reset Password | Grandmaster Academy",
    description: "Request a single-use password reset link for your Academy account.",
    path: "/academy/forgot",
    robots: "noindex,nofollow",
  },
  reset: {
    title: "Choose a New Password | Grandmaster Academy",
    description: "Set a new password for your Academy account.",
    path: "/academy/reset",
    robots: "noindex,nofollow",
  },
  privacy: {
    title: "Privacy Policy | Grandmaster Academy",
    description:
      "How Grandmaster Academy stores account, progress and security data.",
    path: "/privacy",
  },
  terms: {
    title: "Terms of Use | Grandmaster Academy",
    description:
      "Terms for using Grandmaster Academy's education-only trading content.",
    path: "/terms",
  },
  support: {
    title: "Support | Grandmaster Academy",
    description: "Get help with your Grandmaster Academy account or learning progress.",
    path: "/support",
  },
};

const PRIVATE_TITLES = {
  home: "Courses | Grandmaster Academy",
  courses: "Courses | Grandmaster Academy",
  course: "Course | Grandmaster Academy",
  lesson: "Lesson | Grandmaster Academy",
  quiz: "Quiz | Grandmaster Academy",
  progress: "Progress | Grandmaster Academy",
  profile: "Profile | Grandmaster Academy",
};

function seoForRoute(route, signedIn) {
  if (["privacy", "terms", "support"].includes(route.name)) {
    return PUBLIC_SEO[route.name];
  }
  if (signedIn) {
    return {
      title: PRIVATE_TITLES[route.name] || "Grandmaster Academy",
      description:
        "Private learning area. Sign in to view your courses, quizzes and progress.",
      path: currentPath(),
      robots: "noindex,nofollow",
    };
  }
  if (route.name === "home") return PUBLIC_SEO.landing;
  return (
    PUBLIC_SEO[route.name] || {
      title: "Sign In | Grandmaster Academy",
      description:
        "Sign in to Grandmaster Academy to continue your lessons, quizzes and saved progress.",
      path: currentPath(),
      robots: "noindex,nofollow",
    }
  );
}

function loadTheme() {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  return ["system", "light", "dark"].includes(stored) ? stored : "system";
}

function useResource(enabled, load, key) {
  const [state, setState] = useState({ loading: false, error: "", data: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, error: "", data: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: "", data: null });
    (async () => {
      try {
        const data = await load();
        if (!cancelled) setState({ loading: false, error: "", data });
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, error: statusMessage(error, t), data: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  const replace = useCallback((data) => setState((prev) => ({ ...prev, data })), []);
  return [state, reload, replace];
}

export default function AcademyApp() {
  const [path, setPath] = useState(currentPath);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(loadTheme);
  const [session, setSession] = useState(undefined);
  const [bootError, setBootError] = useState("");
  const [quizResult, setQuizResult] = useState(null);

  const route = useMemo(() => parsePath(path), [path]);
  const signedIn = Boolean(session);
  const userId = session?.id || "";
  const seo = useMemo(() => seoForRoute(route, signedIn), [route, signedIn]);
  useSeo(seo);

  const navigate = useCallback((to, options = {}) => {
    if (typeof window !== "undefined" && window.location.pathname !== to) {
      window.history.pushState({}, "", to);
    }
    setPath(to.replace(/\/+$/, "") || "/academy");
    setNotice(options.notice || "");
    setQuizResult(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onPop = () => {
      setPath(currentPath());
      setQuizResult(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.academyTheme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const bootstrap = useCallback(async () => {
    setBootError("");
    try {
      const data = await api("/auth/session");
      setSession(data.user || null);
    } catch (error) {
      if (error?.status === 503) {
        setSession(null);
        setBootError(t("backendMisconfigured"));
      } else if (error?.status === 401) {
        setSession(null);
      } else {
        setSession(null);
        setBootError(t("networkError"));
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    navigator.serviceWorker.register("/sw.js", { scope: "/academy" }).catch(() => {
      /* offline support is optional */
    });
    return undefined;
  }, []);

  const signIn = useCallback(
    async (email, password) => {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      setSession(data.user);
      setNotice("");
      navigate("/academy/courses");
      return data;
    },
    [navigate],
  );

  const signUp = useCallback(
    async (payload) => {
      const data = await api("/auth/signup", { method: "POST", body: payload });
      if (data.authenticated && data.user) {
        setSession(data.user);
        navigate("/academy/courses");
      }
      return data;
    },
    [navigate],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* cookie clears on the server anyway */
    }
    setSession(null);
    navigate("/academy");
  }, [navigate]);

  const forgot = useCallback(async (email) => {
    return api("/auth/forgot-password", { method: "POST", body: { email } });
  }, []);

  const resetPassword = useCallback(async (token, newPassword) => {
    return api("/auth/reset-password", { method: "POST", body: { token, newPassword } });
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    return api("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
  }, []);

  const deleteAccount = useCallback(
    async (password) => {
      await api("/auth/account", { method: "DELETE", body: { password } });
      setSession(null);
      navigate("/academy/login", { notice: t("accountDeleted") });
    },
    [navigate],
  );

  const pageKey = `${route.name}:${route.id || ""}:${userId}`;

  const [coursesState, reloadCourses] = useResource(
    signedIn && (route.name === "courses" || route.name === "home"),
    () => api("/academy/courses"),
    pageKey,
  );
  const [courseState, reloadCourse] = useResource(
    signedIn && route.name === "course",
    () => api(`/academy/courses/${encodeURIComponent(route.id)}`),
    pageKey,
  );
  const [lessonState, reloadLesson, replaceLesson] = useResource(
    signedIn && route.name === "lesson",
    () => api(`/academy/lessons/${encodeURIComponent(route.id)}`),
    pageKey,
  );
  const [quizState, reloadQuiz] = useResource(
    signedIn && route.name === "quiz",
    () => api(`/academy/quizzes/${encodeURIComponent(route.id)}`),
    pageKey,
  );
  const [attemptsState, reloadAttempts] = useResource(
    signedIn && route.name === "quiz",
    () => api(`/academy/quizzes/${encodeURIComponent(route.id)}/attempts`),
    pageKey,
  );
  const [progressState, reloadProgress] = useResource(
    signedIn && route.name === "progress",
    () => api("/academy/progress"),
    pageKey,
  );
  const [profileState, reloadProfile] = useResource(
    signedIn && route.name === "profile",
    () => api("/academy/profile"),
    pageKey,
  );

  const [completing, setCompleting] = useState(false);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  async function completeLesson(lessonId) {
    setCompleting(true);
    try {
      const data = await api(`/academy/lessons/${encodeURIComponent(lessonId)}/complete`, {
        method: "POST",
        body: {},
      });
      const current = lessonState.data?.lesson;
      if (current) {
        replaceLesson({
          lesson: { ...current, completed: true, completedAt: data.completedAt },
        });
      }
    } catch (error) {
      replaceLesson({
        lesson: { ...(lessonState.data?.lesson || {}), error: statusMessage(error, t) },
      });
    } finally {
      setCompleting(false);
    }
  }

  async function submitQuiz(answers) {
    setSubmittingQuiz(true);
    try {
      const data = await api(`/academy/quizzes/${encodeURIComponent(route.id)}/attempts`, {
        method: "POST",
        body: { answers },
      });
      setQuizResult(data.attempt);
      reloadAttempts();
      reloadProgress();
    } catch (error) {
      setQuizResult(null);
      replaceLesson({ quizError: statusMessage(error, t) });
    } finally {
      setSubmittingQuiz(false);
    }
  }

  const resetToken = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, [path]);

  const showNav = signedIn && ["courses", "home", "course", "lesson", "quiz", "progress", "profile"].includes(route.name);
  const navTab = route.name === "progress" ? "progress" : route.name === "profile" ? "profile" : "courses";

  function renderPublic() {
    if (route.name === "privacy" || route.name === "terms" || route.name === "support") {
      return <LegalScreen t={t} kind={route.name} onNavigate={navigate} />;
    }
    if (route.name === "login") {
      return <LoginScreen t={t} onSignIn={signIn} onNavigate={navigate} notice={notice} />;
    }
    if (route.name === "signup") {
      return <SignupScreen t={t} onSignUp={signUp} onNavigate={navigate} />;
    }
    if (route.name === "forgot") {
      return <ForgotScreen t={t} onForgot={forgot} onNavigate={navigate} />;
    }
    if (route.name === "reset") {
      return <ResetScreen t={t} token={resetToken} onReset={resetPassword} onNavigate={navigate} />;
    }
    if (route.name !== "landing" && route.name !== "home") {
      return <LoginScreen t={t} onSignIn={signIn} onNavigate={navigate} notice={t("authRequiredBody")} />;
    }
    return <LandingScreen t={t} onNavigate={navigate} />;
  }

  function renderSignedIn() {
    if (route.name === "privacy" || route.name === "terms" || route.name === "support") {
      return <LegalScreen t={t} kind={route.name} onNavigate={navigate} />;
    }
    if (route.name === "course") {
      return (
        <CourseScreen
          t={t}
          course={courseState.data?.course}
          loading={courseState.loading}
          error={courseState.error}
          onRetry={reloadCourse}
          onNavigate={navigate}
        />
      );
    }
    if (route.name === "lesson") {
      return (
        <LessonScreen
          t={t}
          lesson={lessonState.data?.lesson}
          loading={lessonState.loading}
          error={lessonState.error || lessonState.data?.lesson?.error || ""}
          onRetry={reloadLesson}
          onNavigate={navigate}
          onComplete={completeLesson}
          completing={completing}
        />
      );
    }
    if (route.name === "quiz") {
      return (
        <QuizScreen
          t={t}
          quiz={quizState.data?.quiz}
          attempts={attemptsState.data?.attempts}
          loading={quizState.loading}
          error={quizState.error}
          onRetry={reloadQuiz}
          onSubmit={submitQuiz}
          submitting={submittingQuiz}
          result={quizResult}
          onResetResult={() => setQuizResult(null)}
          onNavigate={navigate}
        />
      );
    }
    if (route.name === "progress") {
      return (
        <ProgressScreen
          t={t}
          progress={progressState.data?.progress}
          loading={progressState.loading}
          error={progressState.error}
          onRetry={reloadProgress}
          onNavigate={navigate}
        />
      );
    }
    if (route.name === "profile") {
      return (
        <ProfileScreen
          t={t}
          user={session}
          profile={profileState.data?.profile}
          loading={profileState.loading}
          error={profileState.error}
          onRetry={reloadProfile}
          theme={theme}
          onTheme={setTheme}
          onChangePassword={changePassword}
          onDeleteAccount={deleteAccount}
          onSignOut={signOut}
          notice={notice}
        />
      );
    }
    if (route.name === "courses" || route.name === "home") {
      return (
        <CoursesScreen
          t={t}
          courses={coursesState.data?.courses}
          loading={coursesState.loading}
          error={coursesState.error}
          onRetry={reloadCourses}
          onNavigate={navigate}
        />
      );
    }
    return <LandingScreen t={t} onNavigate={navigate} />;
  }

  return (
    <div className="academy" data-theme={theme}>
      <a className="ac-skip" href="#academy-content">
        {t("skipToContent")}
      </a>
      <header className="ac-topbar">
        <button type="button" className="ac-brand" onClick={() => navigate("/academy")}>
          <span className="ac-brand-mark" aria-hidden="true">G</span>
          <span>
            <strong>{t("appName")}</strong>
            <small>{t("tagline")}</small>
          </span>
        </button>
        <ThemeToggle theme={theme} onChange={setTheme} t={t} />
      </header>

      <div id="academy-content" className="ac-content">
        {session === undefined && <Spinner label={t("loading")} />}
        {session === null && bootError && (
          <main className="ac-main">
            <Notice tone="danger" onRetry={bootstrap} retryLabel={t("retry")}>
              {bootError}
            </Notice>
          </main>
        )}
        {session === null && !bootError && renderPublic()}
        {signedIn && renderSignedIn()}
      </div>

      {showNav && <BottomNav tab={navTab} onNavigate={navigate} t={t} />}
    </div>
  );
}
