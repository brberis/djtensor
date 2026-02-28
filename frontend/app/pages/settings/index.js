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

import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import StudyMembers from '../../components/StudyMembers';
import theme from '../../theme';

function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function SettingsPage() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { canManageMembers } = usePermissions();
  const [selectedStudyId, setSelectedStudyId] = useState(null);
  const [currentStudy, setCurrentStudy] = useState(null);
  const [modeLoading, setModeLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const storageKey = 'selectedStudy_' + user.id;
    const sid = localStorage.getItem(storageKey) || localStorage.getItem('selectedStudy');
    setSelectedStudyId(sid);
    if (sid) {
      fetch('/api/feature_extractor/studies/')
        .then(r => r.json())
        .then(data => {
          const studies = Array.isArray(data) ? data : data.results || [];
          const study = studies.find(s => String(s.id) === String(sid));
          if (study) setCurrentStudy(study);
        })
        .catch(console.error);
    }
  }, [user]);

  const handleModeToggle = async () => {
    if (!currentStudy) return;
    const newMode = currentStudy.mode === 'experiment' ? 'review' : 'experiment';
    setModeLoading(true);
    try {
      const res = await fetch('/api/feature_extractor/studies/' + currentStudy.id + '/', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentStudy(updated);
      }
    } catch (e) {
      console.error('Failed to update study mode:', e);
    } finally {
      setModeLoading(false);
    }
  };

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

      {/* Study-level settings — visible to study owners */}
      {selectedStudyId && canManageMembers(selectedStudyId) && (
        <div className="mt-8 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Study Settings
            {currentStudy && <span className="ml-2 text-sm font-normal text-gray-500">({currentStudy.name})</span>}
          </h2>

          {/* Study Mode toggle */}
          <div className={theme.classes.card}>
            <div className="px-6 py-5">
              <h3 className="text-base font-semibold leading-6 text-gray-900">Study Mode</h3>
              <p className="mt-1 text-sm text-gray-500">
                In <strong>Experiment</strong> mode, editors have full access to create, edit, and run sessions.
                In <strong>Review</strong> mode, editors are downgraded to viewer permissions — only owners can make changes.
              </p>
              {currentStudy && (
                <div className="mt-4 flex items-center gap-4">
                  <span className={'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ' +
                    (currentStudy.mode === 'review'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800')}>
                    {currentStudy.mode === 'review' ? 'Review Mode' : 'Experiment Mode'}
                  </span>
                  <button
                    onClick={handleModeToggle}
                    disabled={modeLoading}
                    className={modeLoading ? theme.classes.btnDisabled : 'rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50'}
                  >
                    {modeLoading ? 'Switching...' : 'Switch to ' + (currentStudy.mode === 'review' ? 'Experiment' : 'Review')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Study Members */}
          <div className={theme.classes.card}>
            <div className="px-6 py-5">
              <h3 className="text-base font-semibold leading-6 text-gray-900">Study Members</h3>
              <p className="mt-1 mb-4 text-sm text-gray-500">
                Manage who has access to this study and their roles.
              </p>
              <StudyMembers studyId={selectedStudyId} />
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
