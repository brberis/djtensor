/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: AuthContext.js
 * Copyright (c) 2024
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';

const AuthContext = createContext(null);

// Helper to read a cookie value by name
function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Check the current session status against the Django backend
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/auth/api/status/', { credentials: 'include' });
      const data = await res.json();
      if (data.isAuthenticated) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username, password) => {
    // Fetch a fresh CSRF token before logging in
    await fetch('/auth/api/csrf/', { credentials: 'include' });
    const csrfToken = getCookie('csrftoken');

    const res = await fetch('/auth/api/login/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken || '',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      setUser(data.user);
      return { success: true };
    }
    return { success: false, error: data.error || 'Login failed' };
  };

  const logout = async () => {
    const csrfToken = getCookie('csrftoken');
    try {
      await fetch('/auth/api/logout/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': csrfToken || '' },
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    setUser(null);
    router.push('/login');
  };

  const changePassword = async (currentPassword, newPassword) => {
    const csrfToken = getCookie('csrftoken');
    const res = await fetch('/auth/api/password/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken || '',
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Password change failed' };
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
