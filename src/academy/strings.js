/**
 * Every visible academy string lives here so Urdu / Roman Urdu / English can
 * be added without touching components. Only English is populated in Phase 1.
 */

export const DISCLAIMER =
  "Educational content only. Not financial advice. Trading involves risk of loss.";

export const STRINGS = {
  en: {
    appName: "Grandmaster Academy",
    tagline: "Learn trading concepts safely — at your own pace.",
    disclaimerTitle: "Important",
    disclaimer: DISCLAIMER,

    navCourses: "Courses",
    navProgress: "Progress",
    navProfile: "Profile",

    landingHeadline: "Understand trading before you risk anything.",
    landingBody:
      "Short lessons on markets, risk and order mechanics. No signals, no trade calls, no profit promises.",
    landingFeatureOne: "Three focused lessons you can finish today",
    landingFeatureTwo: "A short quiz with explanations for every answer",
    landingFeatureThree: "Progress and streaks that stay on this device's account",
    startLearning: "Create a free account",
    signInCta: "Sign in",
    signUpCta: "Create account",
    continueLearning: "Continue learning",

    signIn: "Sign in",
    signUp: "Sign up",
    signOut: "Sign out",
    welcomeBack: "Welcome back",
    createAccountTitle: "Create your account",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    currentPassword: "Current password",
    newPassword: "New password",
    displayName: "Display name (optional)",
    forgotPassword: "Forgot password?",
    resetPassword: "Reset password",
    noAccount: "New here?",
    haveAccount: "Already have an account?",
    passwordHint: "At least 10 characters.",
    emailPlaceholder: "you@example.com",
    resetRequestTitle: "Reset your password",
    resetRequestBody:
      "Enter your email. If an account exists, a single-use reset link is created.",
    resetRequestSent:
      "If the email is registered, a reset link has been sent.",
    resetDevTokenLabel: "Development reset token (no email provider configured):",
    resetTitle: "Choose a new password",
    resetSuccess: "Password updated. Sign in with the new password.",
    resetMissingToken: "This reset link is missing its token. Request a new one.",
    sessionExpired: "Your session expired. Sign in again.",

    coursesTitle: "Courses",
    coursesSubtitle: "Every lesson is educational. Nothing here is advice.",
    lessons: "lessons",
    lesson: "Lesson",
    lessonCount: "lessons",
    startCourse: "Start course",
    continueCourse: "Continue course",
    markComplete: "Mark complete",
    completed: "Completed",
    completedOn: "Completed",
    backToCourse: "Back to course",
    quizAvailable: "Quiz available",
    videoLink: "Optional video",

    progressTitle: "Progress",
    progressSubtitle: "Your own learning record, stored on your account.",
    percentComplete: "complete",
    lessonsCompleted: "lessons completed",
    streakDays: "day streak",
    lastActivity: "Last activity",
    noActivity: "No activity yet. Finish a lesson to start your streak.",
    recentLessons: "Recently completed",
    recentAttempts: "Recent quiz attempts",
    noAttempts: "No quiz attempts yet.",
    scoreLabel: "Score",

    quizTitle: "Quiz",
    questionOf: "Question {current} of {total}",
    submitAnswers: "Submit answers",
    quizResultTitle: "Quiz result",
    passed: "Passed",
    notPassed: "Not passed",
    correctAnswer: "Correct answer",
    yourAnswer: "Your answer",
    explanation: "Why",
    tryAgain: "Try again",
    quizHistory: "Previous attempts",
    answerAll: "Answer every question before submitting.",

    profileTitle: "Profile",
    accountSection: "Account",
    securitySection: "Security",
    changePassword: "Change password",
    updatePassword: "Update password",
    passwordUpdated: "Password updated. Other sessions were signed out.",
    deleteAccount: "Delete account",
    deleteWarning:
      "This permanently deletes your account, progress and quiz attempts. This cannot be undone.",
    deleteConfirm: "Delete my account",
    accountDeleted: "Your account was deleted.",
    roleAdmin: "Admin",
    roleStudent: "Student",
    memberSince: "Member since",
    themeLabel: "Appearance",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    legalLinks: "Legal",

    privacyTitle: "Privacy Policy",
    termsTitle: "Terms of Use",
    supportTitle: "Support",
    deleteInfoTitle: "Delete your account",
    legalPlaceholder:
      "Placeholder text for Phase 1. Final policy wording must be reviewed before store submission.",
    privacyBody:
      "The academy stores your email, a bcrypt password hash, lesson progress, quiz attempts and a security audit log. Passwords and reset tokens are never stored in plaintext. Reset tokens are single-use and expire after 30 minutes. Account deletion removes your profile, progress and attempts, and detaches audit rows from your identity.",
    termsBody:
      "This app provides educational content about trading concepts. It is not financial advice, not a recommendation, and not a signal service. No outcome is guaranteed and trading involves risk of loss. You are responsible for complying with the laws that apply where you live.",
    supportBody:
      "Support is not connected yet. Use the contact address published with the store listing once available. Do not send passwords, API keys or account credentials to anyone.",
    deleteInfoBody:
      "Sign in, open Profile, choose Delete account and confirm with your password. Your account, progress and quiz attempts are deleted immediately. Audit rows are kept without your identity for security purposes.",

    loading: "Loading…",
    genericError: "Something went wrong. Please try again.",
    networkError: "Cannot reach the server. Check your connection and retry.",
    retry: "Retry",
    offlineTitle: "You are offline",
    offlineBody:
      "The academy needs a connection for account and progress data. Reconnect and try again.",
    authRequiredTitle: "Sign in to continue",
    authRequiredBody:
      "Courses, progress and profile need an account. Sign in or create one.",
    backendMisconfigured:
      "The server is missing its session configuration. Ask the owner to set GRANDMASTER_SESSION_SECRET.",

    errorEmail: "Enter a valid email address.",
    errorPasswordLength: "Password must be at least 10 characters.",
    errorMismatch: "Passwords do not match.",
    errorRequired: "Fill in every required field.",
    errorInvalidCredentials: "Invalid email or password.",
    errorLocked: "Too many attempts. Try again later.",
    errorRateLimited: "Too many attempts. Wait a minute and try again.",
    errorWeakPassword: "Choose a stronger password (10+ characters).",
    errorResetInvalid: "This reset link is invalid or has expired.",

    menuLabel: "Menu",
    closeLabel: "Close",
    skipToContent: "Skip to content",
    openCommandCenter: "Open Command Center",
    backHome: "Back",
    logoutDone: "Signed out.",
    deleteUnderstand: "I understand this cannot be undone.",
    deletePasswordPrompt: "Confirm with your password",
  },
};

export const LOCALES = Object.keys(STRINGS);

export function t(key, locale = "en") {
  const table = STRINGS[locale] || STRINGS.en;
  return table[key] ?? STRINGS.en[key] ?? key;
}

export default t;
