import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';

export default function SetupUsername() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkUser() {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          setUser(currentUser);
          const savedUsername = localStorage.getItem('username');
          if (savedUsername) {
            setUsername(savedUsername);
          }
        }
      } catch (err) {
        const savedUsername = localStorage.getItem('username');
        if (savedUsername) {
          setUsername(savedUsername);
        }
      }
    }
    checkUser();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      setError('Please enter a username.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Save to localStorage
      localStorage.setItem('username', cleanUsername);

      // 2. Save to Supabase table "profiles"
      let currentUserId = user?.id;
      if (!currentUserId) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        currentUserId = currentUser?.id;
      }

      if (currentUserId) {
        const { error: dbError } = await supabase
          .from('profiles')
          .upsert(
            {
              id: currentUserId,
              username: cleanUsername,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          );

        if (dbError) {
          console.warn('Supabase profiles upsert notice:', dbError.message);
        }
      }

      // 3. Navigate to /dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('Error saving username:', err);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="setup-username-container" style={styles.container}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={styles.logo}>G</div>
          <div>
            <h1 style={styles.title}>Welcome Student</h1>
            <p style={styles.subtitle}>Choose your username to complete your profile setup.</p>
          </div>
        </div>

        {error && (
          <div style={styles.error} role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label htmlFor="username-input" style={styles.label}>
            Username
          </label>
          <input
            id="username-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. grandmaster_student"
            required
            disabled={loading}
            style={styles.input}
          />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            style={{
              ...styles.button,
              opacity: loading || !username.trim() ? 0.6 : 1,
              cursor: loading || !username.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Saving...' : 'Save & Continue to Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    background: 'radial-gradient(ellipse at 60% -20%, rgba(245, 188, 75, 0.09), transparent 45%), #080a11',
    color: '#f1f3fa',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  card: {
    width: 'min(440px, 100%)',
    background: 'linear-gradient(145deg, #121622, #0e111a)',
    border: '1px solid rgba(255, 255, 255, 0.085)',
    borderRadius: '16px',
    padding: '28px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    marginBottom: '20px',
  },
  logo: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'grid',
    placeItems: 'center',
    color: '#211706',
    background: 'linear-gradient(135deg, #ffe09a, #f5bc4b)',
    fontWeight: '900',
    fontSize: '22px',
    boxShadow: '0 5px 25px rgba(245, 188, 75, 0.25)',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '800',
    color: '#ffffff',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: '12px',
    color: '#9098ad',
  },
  error: {
    marginBottom: '16px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(255, 115, 125, 0.1)',
    border: '1px solid rgba(255, 115, 125, 0.3)',
    color: '#ff737d',
    fontSize: '12px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#aab0c1',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    background: '#090c14',
    color: '#ffffff',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #ffe09a, #f5bc4b)',
    color: '#211706',
    fontWeight: '700',
    fontSize: '14px',
    marginTop: '6px',
    transition: 'opacity 0.2s, transform 0.1s',
  },
};
