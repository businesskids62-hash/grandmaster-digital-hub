import { supabase } from './supabaseClient.js';

export async function signInWithGoogle() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirectTo = `${origin}/setup-username`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
    },
  });

  if (error) throw error;
  return data;
}
