/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: settings/index.js
 * Copyright (c) 2024
 */

import { useState } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import theme from '../../theme';

export default function SettingsPage() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setSubmitting(true);
    const result = await changePassword(currentPassword, newPassword);
    setSubmitting(false);

    if (result.success) {
      setMessage({ type: 'success', text: 'Password updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setMessage({ type: 'error', text: result.error });
    }
  };

  return (
    <Layout>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your account preferences and security.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* User info card */}
        <div className={theme.classes.card}>
          <div className="px-6 py-5">
            <h3 className="text-base font-semibold leading-6 text-gray-900">Profile</h3>
            <div className="mt-4 space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Username</dt>
                <dd className="mt-1 text-sm text-gray-900">{user?.username}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Email</dt>
                <dd className="mt-1 text-sm text-gray-900">{user?.email || 'Not set'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Name</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {user?.firstName || user?.lastName
                    ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                    : 'Not set'}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* Password change card */}
        <div className={theme.classes.card}>
          <div className="px-6 py-5">
            <h3 className="text-base font-semibold leading-6 text-gray-900">Change Password</h3>
            <form className="mt-4 space-y-4" onSubmit={handlePasswordChange}>
              {message && (
                <div
                  className={`rounded-md p-3 ${
                    message.type === 'success'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  <p className="text-sm">{message.text}</p>
                </div>
              )}
              <div>
                <label htmlFor="currentPassword" className={theme.classes.label}>
                  Current Password
                </label>
                <input
                  id="currentPassword"
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={`mt-1 ${theme.classes.input}`}
                />
              </div>
              <div>
                <label htmlFor="newPassword" className={theme.classes.label}>
                  New Password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={`mt-1 ${theme.classes.input}`}
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className={theme.classes.label}>
                  Confirm New Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`mt-1 ${theme.classes.input}`}
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className={submitting ? theme.classes.btnDisabled : theme.classes.btnPrimary}
                >
                  {submitting ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  );
}
