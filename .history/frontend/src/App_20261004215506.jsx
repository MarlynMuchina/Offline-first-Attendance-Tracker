import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Teacher from './pages/Teacher'
import Admin from './pages/Admin'
import AdminSettings from './pages/AdminSettings'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
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
      </Routes>
    </BrowserRouter>
  )
}