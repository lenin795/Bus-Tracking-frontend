import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';  // ← Add this
import AdminPage from './pages/AdminPage';
import DriverPage from './pages/DriverPage';
import PassengerPage from './pages/PassengerPage';
import PrivateRoute from './components/common/PrivateRoute';
import ConnectionTest from './pages/ConnectionTest';
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />  {/* ← Add this */}
          
          {/* Public route for passengers */}
          <Route path="/track" element={<PassengerPage />} />
          <Route path="/passenger" element={<PassengerPage />} />
          
          <Route 
            path="/admin/*" 
            element={
              <PrivateRoute role="admin">
                <AdminPage />
              </PrivateRoute>
            } 
          />
          
          <Route 
            path="/driver/*" 
            element={
              <PrivateRoute role="driver">
                <DriverPage />
              </PrivateRoute>
            } 
          />
          <Route path="/test" element={<ConnectionTest />} />
          <Route path="/" element={<Navigate to="/track" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;