import { Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<div className="p-8 text-2xl font-bold">SISKOP — Coming Soon</div>}
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
