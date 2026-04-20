import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Display } from './pages/Display';
import { Admin } from './pages/Admin';
import './index.css';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Display />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
