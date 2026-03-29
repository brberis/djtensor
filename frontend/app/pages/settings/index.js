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

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import StudyMembers from '../../components/StudyMembers';
import theme from '../../theme';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// Draggable study item for reordering
function SortableStudyItem({ study }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: study.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
        isDragging ? 'bg-blue-50 border-blue-300 shadow-lg' : 'bg-white border-gray-200'
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
        {...attributes}
        {...listeners}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{study.name}</p>
        {study.created_at && (
          <p className="text-xs text-gray-400">
            {new Date(study.created_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
        )}
      </div>
    </div>
  );
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

  // Study ordering state (superuser only)
  const [orderStudies, setOrderStudies] = useState([]);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState(null);

  // Batch permissions state (superuser only)
  const [allUsers, setAllUsers] = useState([]);
  const [allStudies, setAllStudies] = useState([]);
  const [batchUserIds, setBatchUserIds] = useState([]);
  const [batchStudyIds, setBatchStudyIds] = useState([]);
  const [batchRole, setBatchRole] = useState('editor');
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchMessage, setBatchMessage] = useState(null);

  // Synthetic tools toggle state (superuser only)
  const [showSyntheticTools, setShowSyntheticTools] = useState(false);
  const [syntheticSaving, setSyntheticSaving] = useState(false);
  const [syntheticMessage, setSyntheticMessage] = useState(null);

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

  // Fetch data for admin sections
  useEffect(() => {
    if (!user?.isSuperuser) return;

    // Fetch all studies for ordering + batch
    fetch('/api/feature_extractor/studies/')
      .then(r => r.json())
      .then(data => {
        const studies = Array.isArray(data) ? data : data.results || [];
        setOrderStudies(studies);
        setAllStudies(studies);
      })
      .catch(console.error);

    // Fetch all users for batch permissions
    fetch('/api/feature_extractor/users')
      .then(r => r.json())
      .then(data => {
        const users = Array.isArray(data) ? data : data.results || [];
        setAllUsers(users);
      })
      .catch(console.error);

    // Fetch site settings
    fetch('/api/feature_extractor/site-settings/')
      .then(r => r.json())
      .then(data => {
        if (data.show_synthetic_tools !== undefined) {
          setShowSyntheticTools(data.show_synthetic_tools);
        }
      })
      .catch(console.error);
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

  // --- Study Ordering (drag-and-drop) ---
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderStudies((items) => {
      const oldIndex = items.findIndex((s) => s.id === active.id);
      const newIndex = items.findIndex((s) => s.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  }, []);

  const saveOrder = async () => {
    setOrderSaving(true);
    setOrderMessage(null);
    try {
      const res = await fetch('/api/feature_extractor/studies/reorder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ order: orderStudies.map((s) => s.id) }),
      });
      if (res.ok) {
        setOrderMessage({ type: 'success', text: 'Study order saved' });
      } else {
        const err = await res.json().catch(() => ({}));
        setOrderMessage({ type: 'error', text: err.message || 'Failed to save order' });
      }
    } catch (e) {
      setOrderMessage({ type: 'error', text: 'Failed to save order' });
    } finally {
      setOrderSaving(false);
    }
  };

  // --- Batch Permissions ---
  const toggleBatchUser = (userId) => {
    setBatchUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleBatchStudy = (studyId) => {
    setBatchStudyIds((prev) =>
      prev.includes(studyId) ? prev.filter((id) => id !== studyId) : [...prev, studyId]
    );
  };

  const toggleAllBatchUsers = () => {
    if (batchUserIds.length === allUsers.length) {
      setBatchUserIds([]);
    } else {
      setBatchUserIds(allUsers.map((u) => u.id));
    }
  };

  const toggleAllBatchStudies = () => {
    if (batchStudyIds.length === allStudies.length) {
      setBatchStudyIds([]);
    } else {
      setBatchStudyIds(allStudies.map((s) => s.id));
    }
  };

  const handleBatchAssign = async () => {
    if (batchUserIds.length === 0 || batchStudyIds.length === 0) return;
    setBatchSaving(true);
    setBatchMessage(null);
    try {
      const res = await fetch('/api/feature_extractor/study-memberships/batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({
          user_ids: batchUserIds,
          study_ids: batchStudyIds,
          role: batchRole,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBatchMessage({
          type: 'success',
          text: `Done! ${data.created} membership${data.created !== 1 ? 's' : ''} created, ${data.updated} updated.`,
        });
        setBatchUserIds([]);
        setBatchStudyIds([]);
      } else {
        const err = await res.json().catch(() => ({}));
        setBatchMessage({ type: 'error', text: err.message || 'Failed to assign permissions' });
      }
    } catch (e) {
      setBatchMessage({ type: 'error', text: 'Failed to assign permissions' });
    } finally {
      setBatchSaving(false);
    }
  };

  const handleSyntheticToggle = async () => {
    setSyntheticSaving(true);
    setSyntheticMessage(null);
    try {
      const res = await fetch('/api/feature_extractor/site-settings/', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ show_synthetic_tools: !showSyntheticTools }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowSyntheticTools(data.show_synthetic_tools);
        setSyntheticMessage({ type: 'success', text: data.show_synthetic_tools ? 'Synthetic tools visible to team' : 'Synthetic tools hidden from team' });
      } else {
        setSyntheticMessage({ type: 'error', text: 'Failed to update setting' });
      }
    } catch (e) {
      setSyntheticMessage({ type: 'error', text: 'Failed to update setting' });
    } finally {
      setSyntheticSaving(false);
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

      {/* Admin-only sections */}
      {user?.isSuperuser && (
        <div className="mt-8 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Admin Settings</h2>

          {/* Synthetic Data Tools toggle */}
          <div className={theme.classes.card}>
            <div className="px-6 py-5">
              <h3 className="text-base font-semibold leading-6 text-gray-900">Synthetic Data Tools</h3>
              <p className="mt-1 text-sm text-gray-500">
                Controls visibility of experimental synthetic data features (augmentation preview, tooth completeness detection, synthetic fragment generation).
                When disabled, these tools are only visible to admins.
              </p>
              {syntheticMessage && (
                <div className={`rounded-md p-3 mt-3 ${
                  syntheticMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  <p className="text-sm">{syntheticMessage.text}</p>
                </div>
              )}
              <div className="mt-4 flex items-center gap-4">
                <span className={'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ' +
                  (showSyntheticTools
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800')}>
                  {showSyntheticTools ? 'Visible to Team' : 'Admin Only'}
                </span>
                <button
                  onClick={handleSyntheticToggle}
                  disabled={syntheticSaving}
                  className={syntheticSaving ? theme.classes.btnDisabled : 'rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50'}
                >
                  {syntheticSaving ? 'Updating...' : (showSyntheticTools ? 'Hide from Team' : 'Show to Team')}
                </button>
              </div>
            </div>
          </div>

          {/* Study Order — drag and drop */}
          <div className={theme.classes.card}>
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold leading-6 text-gray-900">Study Order</h3>
                <button
                  onClick={saveOrder}
                  disabled={orderSaving}
                  className={orderSaving ? theme.classes.btnDisabled : theme.classes.btnPrimary}
                >
                  {orderSaving ? 'Saving...' : 'Save Order'}
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Drag and drop to reorder studies. This order is used across the entire application.
              </p>
              {orderMessage && (
                <div className={`rounded-md p-3 mb-4 ${
                  orderMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  <p className="text-sm">{orderMessage.text}</p>
                </div>
              )}
              <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={orderStudies.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {orderStudies.map((study) => (
                      <SortableStudyItem key={study.id} study={study} />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </div>

          {/* Batch Permissions */}
          <div className={theme.classes.card}>
            <div className="px-6 py-5">
              <h3 className="text-base font-semibold leading-6 text-gray-900">Batch Permissions</h3>
              <p className="mt-1 mb-4 text-sm text-gray-500">
                Assign a role to multiple users across multiple studies at once.
              </p>
              {batchMessage && (
                <div className={`rounded-md p-3 mb-4 ${
                  batchMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  <p className="text-sm">{batchMessage.text}</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Users list */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={allUsers.length > 0 && batchUserIds.length === allUsers.length}
                      ref={(el) => {
                        if (el) el.indeterminate = batchUserIds.length > 0 && batchUserIds.length < allUsers.length;
                      }}
                      onChange={toggleAllBatchUsers}
                      className={theme.classes.checkbox}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Users {batchUserIds.length > 0 && `(${batchUserIds.length})`}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                    {allUsers.map((u) => (
                      <label
                        key={u.id}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                          batchUserIds.includes(u.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={batchUserIds.includes(u.id)}
                          onChange={() => toggleBatchUser(u.id)}
                          className={theme.classes.checkbox}
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 truncate">{u.username}</p>
                          {(u.first_name || u.last_name) && (
                            <p className="text-xs text-gray-400 truncate">
                              {[u.first_name, u.last_name].filter(Boolean).join(' ')}
                            </p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Studies list */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={allStudies.length > 0 && batchStudyIds.length === allStudies.length}
                      ref={(el) => {
                        if (el) el.indeterminate = batchStudyIds.length > 0 && batchStudyIds.length < allStudies.length;
                      }}
                      onChange={toggleAllBatchStudies}
                      className={theme.classes.checkbox}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Studies {batchStudyIds.length > 0 && `(${batchStudyIds.length})`}
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg max-h-60 overflow-y-auto">
                    {allStudies.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                          batchStudyIds.includes(s.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={batchStudyIds.includes(s.id)}
                          onChange={() => toggleBatchStudy(s.id)}
                          className={theme.classes.checkbox}
                        />
                        <span className="text-sm text-gray-900 truncate">{s.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Role selector + Apply */}
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Role:</label>
                  <select
                    value={batchRole}
                    onChange={(e) => setBatchRole(e.target.value)}
                    className={`${theme.classes.input} py-1.5 w-32`}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <button
                  onClick={handleBatchAssign}
                  disabled={batchSaving || batchUserIds.length === 0 || batchStudyIds.length === 0}
                  className={
                    batchSaving || batchUserIds.length === 0 || batchStudyIds.length === 0
                      ? theme.classes.btnDisabled
                      : theme.classes.btnPrimary
                  }
                >
                  {batchSaving
                    ? 'Assigning...'
                    : `Assign ${batchUserIds.length} user${batchUserIds.length !== 1 ? 's' : ''} to ${batchStudyIds.length} stud${batchStudyIds.length !== 1 ? 'ies' : 'y'} as ${batchRole}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
