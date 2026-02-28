import { useState, useEffect } from 'react';
import { TrashIcon, PlusIcon, UserPlusIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function StudyMembers({ studyId }) {
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [error, setError] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', firstName: '', lastName: '' });
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  const fetchMembers = async () => {
    if (!studyId) return;
    try {
      const res = await fetch(`/api/feature_extractor/study-memberships/?study=${studyId}`, { credentials: 'include' });
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      console.error('Failed to fetch members:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/feature_extractor/users', { credentials: 'include' });
      const data = await res.json();
      setAllUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  };

  useEffect(() => {
    fetchMembers();
    fetchUsers();
  }, [studyId]);

  // Users not already members of this study
  const memberUserIds = new Set(members.map(m => m.user_detail?.id || m.user));
  const availableUsers = allUsers.filter(u => !memberUserIds.has(u.id) && u.is_active);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(null);
    if (!selectedUserId) return;
    try {
      const res = await fetch('/api/feature_extractor/study-memberships/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ study: studyId, user: parseInt(selectedUserId), role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || 'Failed to add member');
        return;
      }
      setSelectedUserId('');
      setNewRole('viewer');
      fetchMembers();
    } catch (e) {
      setError('Failed to add member');
    }
  };

  const handleChangeRole = async (membershipId, role) => {
    try {
      await fetch(`/api/feature_extractor/study-memberships/${membershipId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ role }),
      });
      fetchMembers();
    } catch (e) {
      console.error('Failed to update role:', e);
    }
  };

  const handleRemove = async (membershipId) => {
    if (!confirm('Remove this member?')) return;
    try {
      await fetch(`/api/feature_extractor/study-memberships/${membershipId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRFToken': getCsrfToken() },
      });
      fetchMembers();
    } catch (e) {
      console.error('Failed to remove member:', e);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch('/api/feature_extractor/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || data.message || 'Failed to create user');
        return;
      }
      setCreateSuccess(`User "${data.username}" created successfully`);
      setCreateForm({ username: '', email: '', password: '', firstName: '', lastName: '' });
      fetchUsers(); // refresh the user list
      // Auto-select the new user in the dropdown
      setTimeout(() => setSelectedUserId(String(data.id)), 300);
    } catch (e) {
      setCreateError('Failed to create user');
    }
  };

  const displayName = (u) => {
    if (u.first_name || u.last_name) {
      return `${u.first_name || ''} ${u.last_name || ''}`.trim() + ` (${u.username})`;
    }
    return u.username;
  };

  if (loading) return <p className="text-sm text-gray-500">Loading members...</p>;

  return (
    <div>
      {/* Members table */}
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">User</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {members.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2 text-sm text-gray-900">
                {m.user_detail?.first_name ? `${m.user_detail.first_name} ${m.user_detail.last_name || ''}`.trim() : m.user_detail?.username}
              </td>
              <td className="px-4 py-2 text-sm text-gray-500">{m.user_detail?.email || '—'}</td>
              <td className="px-4 py-2 text-sm">
                {m.role === 'owner' ? (
                  <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">Owner</span>
                ) : (
                  <select
                    value={m.role}
                    onChange={(e) => handleChangeRole(m.id, e.target.value)}
                    className="rounded-md border-0 py-1 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                {m.role !== 'owner' && (
                  <button onClick={() => handleRemove(m.id)} className="text-gray-400 hover:text-red-500" title="Remove member">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Info about users without roles */}
      <p className="mt-3 text-xs text-gray-400">
        Users not listed here cannot see or access this study.
      </p>

      {/* Add existing user */}
      <div className="mt-5 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          <PlusIcon className="h-4 w-4" />
          Add Existing User
        </h4>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex-1">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
            >
              <option value="">Select a user...</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="rounded-md border-0 py-1.5 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600 sm:text-sm"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={!selectedUserId}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-sm ${
              selectedUserId ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            Add
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {availableUsers.length === 0 && (
          <p className="mt-2 text-xs text-gray-400">All users are already members of this study.</p>
        )}
      </div>

      {/* Create new user */}
      <div className="mt-5 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => setShowCreateUser(!showCreateUser)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
        >
          <UserPlusIcon className="h-4 w-4" />
          Create New User
          {showCreateUser ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
        </button>

        {showCreateUser && (
          <form onSubmit={handleCreateUser} className="mt-3 space-y-3 bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600">Username *</label>
                <input
                  type="text"
                  required
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  className="mt-1 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
                  placeholder="johndoe"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="mt-1 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">First Name</label>
                <input
                  type="text"
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                  className="mt-1 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600">Last Name</label>
                <input
                  type="text"
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                  className="mt-1 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
                  placeholder="Doe"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600">Password * <span className="text-gray-400">(min 8 characters)</span></label>
              <input
                type="password"
                required
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                className="mt-1 block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
              />
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            {createSuccess && <p className="text-sm text-green-600">{createSuccess}</p>}
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              Create User
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
