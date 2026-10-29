import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App.jsx';
import AcademyApp from './academy/AcademyApp.jsx';
import './styles/index.css';

const academyPaths = ['/academy', '/privacy', '/terms', '/support'];
const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '';
const isAcademy =
  academyPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isAcademy ? <AcademyApp /> : <App />}
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>
);
