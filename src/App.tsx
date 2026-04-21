import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component } from 'react';
import type { ReactNode } from 'react';
import { Display } from './pages/Display';
import { Admin } from './pages/Admin';
import './index.css';

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
  return (
    <RootErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Display />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </RootErrorBoundary>
  );
}
