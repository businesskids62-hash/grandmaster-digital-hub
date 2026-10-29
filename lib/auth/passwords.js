import bcrypt from "bcryptjs";

export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  return null;
}

function rounds(env = process.env) {
  const configured = Math.floor(Number(env?.BCRYPT_ROUNDS));
  if (Number.isFinite(configured) && configured >= 4 && configured <= 15) {
    return configured;
  }
  return 10;
}

export function hashPassword(password, env = process.env) {
  return bcrypt.hashSync(password, rounds(env));
}

export function verifyPasswordHash(password, hash) {
  if (typeof password !== "string" || typeof hash !== "string" || !hash) {
    return false;
  }
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}
