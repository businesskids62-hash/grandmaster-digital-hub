import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

test('supabaseClient initializes createClient with environment variables or fallbacks', () => {
  const code = read('src/lib/supabaseClient.js');
  assert.match(code, /import \{ createClient \} from ['"]@supabase\/supabase-js['"]/);
  assert.match(code, /createClient\(/);
  assert.match(code, /VITE_SUPABASE_URL/);
  assert.match(code, /VITE_SUPABASE_ANON_KEY/);
  assert.match(code, /export const supabase =/);
});

test('authHelpers defines signInWithGoogle with redirectTo /setup-username', () => {
  const code = read('src/lib/authHelpers.js');
  assert.match(code, /export async function signInWithGoogle\(/);
  assert.match(code, /signInWithOAuth\(/);
  assert.match(code, /provider:\s*['"]google['"]/);
  assert.match(code, /\/setup-username/);
});

test('SetupUsername saves username to localStorage and Supabase profiles table, then redirects', () => {
  const code = read('src/pages/SetupUsername.jsx');
  assert.match(code, /export default function SetupUsername/);
  assert.match(code, /localStorage\.setItem\(['"]username['"]/);
  assert.match(code, /supabase\s*\.\s*from\(['"]profiles['"]\)/);
  assert.match(code, /navigate\(['"]\/dashboard['"]\)/);
});

test('ProtectedRoute guards /dashboard and redirects unauthenticated users', () => {
  const code = read('src/components/ProtectedRoute.jsx');
  assert.match(code, /export default function ProtectedRoute/);
  assert.match(code, /supabase\.auth\.getSession\(\)/);
  assert.match(code, /<Navigate to=/);
});

test('AuthScreens provide Google login option', () => {
  const code = read('src/academy/AuthScreens.jsx');
  assert.match(code, /signInWithGoogle/);
  assert.match(code, /Continue with Google/);
});

test('main.jsx uses react-router-dom BrowserRouter and protects /dashboard', () => {
  const code = read('src/main.jsx');
  assert.match(code, /BrowserRouter/);
  assert.match(code, /path="\/setup-username"/);
  assert.match(code, /path="\/dashboard"/);
  assert.match(code, /<ProtectedRoute/);
});

test('.env.example documents Supabase configuration keys', () => {
  const envExample = read('.env.example');
  assert.match(envExample, /VITE_SUPABASE_URL=/);
  assert.match(envExample, /VITE_SUPABASE_ANON_KEY=/);
});
