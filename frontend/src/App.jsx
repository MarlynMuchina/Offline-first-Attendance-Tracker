import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import Teacher from './pages/Teacher'
import Admin from './pages/Admin'
import AdminSettings from './pages/AdminSettings'
import ClassManagement from './pages/ClassManagement'
import Network from './pages/Network'
import ProtectedRoute from './components/ProtectedRoute'

// Each page opens at the top, instead of keeping the scroll position of the
// page before it. Links to a section (#register) still jump to that section.
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
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
        <Route path="/admin/classes" element={
        <ProtectedRoute allowedGroups={['Admin', 'HeadTeacher']}>
         <ClassManagement />
         </ProtectedRoute>
         } />
        <Route
          path="/network"
          element={
            <ProtectedRoute allowedGroups={['Admin']}>
              <Network />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}