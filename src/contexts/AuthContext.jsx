import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load token from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    if (storedToken) {
      setAccessToken(storedToken);
      fetchUser(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  // Fetch user data
  const fetchUser = async (token) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setAccessToken(token);
      } else {
        // Token might be expired, try to refresh
        await refreshToken();
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      logout();
    } finally {
      setLoading(false);
    }
  };

  // Register
  const register = async ({ email, password, name }) => {
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, name }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      return { success: true, user: data.user };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  // Login
  const login = async ({ email, password }) => {
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setUser(data.user);
      setAccessToken(data.accessToken);
      localStorage.setItem('accessToken', data.accessToken);

      // Schedule token refresh
      scheduleTokenRefresh(data.expiresIn);

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  // Refresh token
  const refreshToken = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      setAccessToken(data.accessToken);
      localStorage.setItem('accessToken', data.accessToken);

      // Fetch user with new token
      await fetchUser(data.accessToken);

      // Schedule next refresh
      scheduleTokenRefresh(data.expiresIn);

      return data.accessToken;
    } catch (err) {
      console.error('Token refresh failed:', err);
      logout();
      return null;
    }
  };

  // Schedule token refresh before expiry
  const scheduleTokenRefresh = useCallback((expiresIn) => {
    // Parse expiresIn (e.g., "15m" -> 15 minutes)
    const match = expiresIn?.match(/^(\d+)([smh])$/);
    if (!match) return;

    const value = parseInt(match[1]);
    const unit = match[2];
    let ms = value * 1000; // seconds
    if (unit === 'm') ms *= 60; // minutes
    if (unit === 'h') ms *= 3600; // hours

    // Refresh 1 minute before expiry
    const refreshIn = Math.max(ms - 60000, 30000);

    setTimeout(() => {
      refreshToken();
    }, refreshIn);
  }, []);

  // Logout
  const logout = async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setAccessToken(null);
      localStorage.removeItem('accessToken');
    }
  };

  // Update profile
  const updateProfile = async ({ name, avatar_url }) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name, avatar_url }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Update failed');
      }

      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Change password
  const changePassword = async ({ currentPassword, newPassword }) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Password change failed');
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Get auth header for API calls
  const getAuthHeader = () => {
    return accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};
  };

  const value = {
    user,
    accessToken,
    loading,
    error,
    isAuthenticated: !!user,
    register,
    login,
    logout,
    updateProfile,
    changePassword,
    getAuthHeader,
    refreshToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
