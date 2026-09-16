import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Teacher from './pages/Teacher'
import Admin from './pages/Admin'
<<<<<<< Updated upstream
=======
import AdminSettings from './pages/AdminSettings'
import ProtectedRoute from './components/ProtectedRoute'
>>>>>>> Stashed changes

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
<<<<<<< Updated upstream
        <Route path="/teacher" element={<Teacher />} />
        <Route path="/admin" element={<Admin />} />
=======
        <Route
          path="/teacher"
          element={
            <ProtectedRoute allowedGroups={['Teacher']}>
              <Teacher />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedGroups={['Admin', 'HeadTeacher']}>
              <Admin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute allowedGroups={['Admin', 'HeadTeacher']}>
              <AdminSettings />
            </ProtectedRoute>
          }
        />
>>>>>>> Stashed changes
      </Routes>
    </BrowserRouter>
  )
}
