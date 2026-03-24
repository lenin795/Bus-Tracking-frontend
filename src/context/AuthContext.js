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
  const USER_STORAGE_KEY = 'user';

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    const cachedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (token) {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/auth/me`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const mergedUser = {
          ...(cachedUser ? JSON.parse(cachedUser) : {}),
          ...response.data.user
        };
        setUser(mergedUser);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(mergedUser));
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('token');
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    }
    setLoading(false);
  };

  // ✅ FIXED: Removed role parameter
  const login = async (email, password) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/login`,
        { email, password } // ✅ Removed role from here
      );
      
      localStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.data.user));
      return response.data;
    } catch (error) {
      console.error('Login failed:', error.response?.data || error.message);
      throw error;
    }
  };

  const register = async (name, email, password, role, phone) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/register`,
        { name, email, password, role, phone }
      );
      
      localStorage.setItem('token', response.data.token);
      setUser(response.data.user);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.data.user));
      return response.data;
    } catch (error) {
      console.error('Registration failed:', error.response?.data || error.message);
      throw error;
    }
  };

  const updateProfile = async (profileData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.put(
        `${process.env.REACT_APP_API_URL}/api/auth/profile`,
        profileData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const mergedUser = {
        ...(user || {}),
        ...response.data.user,
        avatarUrl: response.data.user?.avatarUrl || profileData.avatarUrl || user?.avatarUrl || '',
        bio: response.data.user?.bio ?? profileData.bio ?? user?.bio ?? '',
        phone: response.data.user?.phone ?? profileData.phone ?? user?.phone ?? '',
        name: response.data.user?.name ?? profileData.name ?? user?.name ?? ''
      };

      setUser(mergedUser);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(mergedUser));
      return { ...response.data, user: mergedUser };
    } catch (error) {
      console.error('Profile update failed:', error.response?.data || error.message);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  };

  const value = {
    user,
    loading,
    login,
    register,
    updateProfile,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
