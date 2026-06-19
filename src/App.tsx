import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component } from 'react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Display } from './pages/Display';
import { Admin } from './pages/Admin';
import { Dealer } from './pages/Dealer';
import './index.css';

const BUILD_CHECK_INTERVAL_MS = 60_000;

function useAutoReloadOnNewBuild() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const currentEntryScript = Array.from(document.scripts).find(script => (
      script.type === 'module' && /\/assets\/index-[^/]+\.js(?:\?|$)/.test(script.src)
    ))?.src;

    if (!currentEntryScript) return;

    let disposed = false;

    const checkForNewBuild = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}index.html?ts=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;

        const html = await response.text();
        const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i);
        if (!match) return;

        const nextEntryScript = new URL(match[1], window.location.origin).href;
        if (!disposed && nextEntryScript !== currentEntryScript) {
          window.location.reload();
        }
      } catch {
        // Network hiccups should not interrupt the display.
      }
    };

    const interval = setInterval(() => {
      void checkForNewBuild();
    }, BUILD_CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message + '\n' + err.stack : String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#1a0000', border: '1px solid #7f1d1d', borderRadius: '16px', padding: '24px', maxWidth: '600px', width: '100%' }}>
            <div style={{ color: '#f87171', fontWeight: 'bold', fontSize: '18px', marginBottom: '12px' }}>
              Ошибка приложения
            </div>
            <pre style={{ color: '#fca5a5', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowY: 'auto', maxHeight: '60vh' }}>
              {this.state.error}
            </pre>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{ marginTop: '16px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useAutoReloadOnNewBuild();

  return (
    <RootErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Display />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/dealer/:tableNumber" element={<Dealer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </RootErrorBoundary>
  );
}
