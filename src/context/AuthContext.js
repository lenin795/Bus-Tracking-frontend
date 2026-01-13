import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/auth/me`, // ✅ Added /api/
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setUser(response.data.user);
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('token');
      }
    }
    setLoading(false);
  };

  const login = async (email, password, role) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/login`, // ✅ Added /api/
        { email, password, role }
      );
      
      localStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      return response.data;
    } catch (error) {
      console.error('Login failed:', error.response?.data || error.message);
      throw error;
    }
  };

  const register = async (name, email, password, role, phone) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/register`, // ✅ Added /api/
        { name, email, password, role, phone }
      );
      
      localStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      return response.data;
    } catch (error) {
      console.error('Registration failed:', error.response?.data || error.message);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};