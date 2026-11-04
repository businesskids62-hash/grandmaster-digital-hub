import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App.jsx';
import AcademyApp from './academy/AcademyApp.jsx';
import SetupUsername from './pages/SetupUsername.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import { LanguageProvider } from './hooks/useLanguage.jsx';
import { ThemeProvider } from './hooks/useTheme.jsx';
import './styles/index.css';

const academyPaths = ['/academy', '/privacy', '/terms', '/support'];
const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '';
const isAcademy =
  academyPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function RootApp() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/setup-username" element={<SetupUsername />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute redirectTo="/academy/login">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="*"
              element={isAcademy ? <AcademyApp /> : <App />}
            />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootApp />
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);
