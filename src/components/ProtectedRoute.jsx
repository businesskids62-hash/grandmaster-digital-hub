import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';

export default function ProtectedRoute({ children, redirectTo = '/academy/login' }) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
          if (mounted) {
            setIsAuthenticated(true);
            setLoading(false);
          }
          return;
        }

        const storedUser = localStorage.getItem('username') || localStorage.getItem('gm_user');
        if (storedUser) {
          if (mounted) {
            setIsAuthenticated(true);
            setLoading(false);
          }
          return;
        }

        if (mounted) {
          setIsAuthenticated(false);
          setLoading(false);
        }
      } catch (err) {
        const storedUser = localStorage.getItem('username');
        if (mounted) {
          setIsAuthenticated(Boolean(storedUser));
          setLoading(false);
        }
      }
    }

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        if (session && session.user) {
          setIsAuthenticated(true);
        } else {
          const storedUser = localStorage.getItem('username');
          setIsAuthenticated(Boolean(storedUser));
        }
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#080a11',
          color: '#f1f3fa',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid rgba(245, 188, 75, 0.2)',
              borderTopColor: '#f5bc4b',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <p style={{ margin: 0, fontSize: '14px', color: '#9098ad' }}>Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  return children ? children : <Outlet />;
}
