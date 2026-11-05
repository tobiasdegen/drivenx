import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initialLocale, translate, type Locale } from './i18n.mts';
import './styles.css';
import './styles/workspace.css';
import './styles/drive-views.css';
import './styles/desktop-theme.css';
import './styles/measurements.css';
import './styles/ata-details.css';
import './styles/query-log.css';
import './styles/overview.css';
import './styles/preferences.css';
import './styles/connection-flow.css';

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('React rendering failed', error, info.componentStack);
  }
  render() {
    const locale: Locale = initialLocale();
    return this.state.error ? (
      <div
        style={{
          color: '#edf2ff',
          background: '#0c1220',
          minHeight: '100vh',
          padding: 36,
          fontFamily: 'system-ui',
        }}
      >
        <h2>DriveNX – {translate(locale, 'smartView', 'startupErrorTitle')}</h2>
        <p>{translate(locale, 'smartView', 'startupErrorInstructions')}</p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
      </div>
    ) : (
      this.props.children
    );
  }
}

window.addEventListener('error', (e) =>
  console.error('Window error:', e.message, e.filename, e.lineno),
);
window.addEventListener('unhandledrejection', (e) =>
  console.error('Unhandled promise rejection:', e.reason),
);
const root = document.getElementById('root');
if (!root) throw new Error('index.html: #root not found');
createRoot(root).render(
  <StartupErrorBoundary>
    <App />
  </StartupErrorBoundary>,
);
