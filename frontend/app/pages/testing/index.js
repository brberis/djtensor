/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: index.js
 * Copyright (c) 2024
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddTest from '../../components/addTest';
import LogViewer from '../../components/LogViewer';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TableSpinnerRow } from '../../components/Spinner';
import { getStatusBadgeClass } from '../../theme';
import { ClipboardDocumentCheckIcon, PencilIcon } from '@heroicons/react/24/outline';
import { usePermissions } from '../../hooks/usePermissions';
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid';

export default function Testing() {
  const [tests, setTests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddTest, setIsOpenAddTest] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [logSessionId, setLogSessionId] = useState(null);
  const [editingTestId, setEditingTestId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const [showArchived, setShowArchived] = useState(false);
  const menuRef = useRef(null);
  const { canMutate, canDelete, isOwner } = usePermissions();
  const openMenuIdRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    openMenuIdRef.current = openMenuId;
  }, [openMenuId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchTests = async () => {
      try {
        const url = '/api/feature_extractor/tests/' + (showArchived ? '?show_archived=true' : '');
        const response = await fetch(url);
        const data = await response.json();

        if (!Array.isArray(data)) throw new Error('Data is not an array');

        const savedStudy = localStorage.getItem('selectedStudy');
        const filteredData = savedStudy
          ? data.filter((test) => test.training_session?.study?.id == savedStudy)
          : data;

        const sortedData = filteredData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (!openMenuIdRef.current) setTests(sortedData);
      } catch (error) {
        console.error('Failed to fetch tests:', error);
        setTests([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTests();
    const intervalId = setInterval(fetchTests, 5000);
    return () => clearInterval(intervalId);
  }, [refresh, showArchived]);

  const getCsrfToken = () => document.cookie.match(/csrftoken=([^;]*)/)?.[1] || '';

  const handleRetest = async (testId) => {
    setOpenMenuId(null);
    const response = await fetch(`/api/feature_extractor/tests/${testId}/retest/`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
      },
    });

    if (response.ok) {
      setRefresh((prev) => !prev);
      return;
    }

    console.error('Re-test failed:', await response.text());
  };

  const handleDelete = async (testId) => {
    setOpenMenuId(null);
    const response = await fetch(`/api/feature_extractor/tests/${testId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
      },
    });

    if (response.status === 204) {
      setRefresh((prev) => !prev);
      return;
    }

    console.error('Delete failed:', await response.text());
  };

  const handleStop = async (testId) => {
    setOpenMenuId(null);
    try {
      await fetch('/api/feature_extractor/tests/' + testId + '/stop/', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      });
      setRefresh(prev => !prev);
    } catch (error) { console.error('Stop error:', error); }
  };

  const handleClone = async (testId) => {
    setOpenMenuId(null);
    try {
      await fetch('/api/feature_extractor/tests/' + testId + '/clone/', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      });
      setRefresh(prev => !prev);
    } catch (error) { console.error('Clone error:', error); }
  };

  const handleShowLogs = (test) => {
    setOpenMenuId(null);
    setLogSessionId(test.training_session?.id || null);
  };

  const handleArchive = async (testId) => {
    setOpenMenuId(null);
    try {
      const response = await fetch(`/api/feature_extractor/tests/${testId}/archive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      });
      if (response.ok) setRefresh(prev => !prev);
    } catch (error) { console.error('Archive error:', error); }
  };

  const handleSaveName = async (testId, newName) => {
    setEditingTestId(null);
    const test = tests.find(t => t.id === testId);
    if (!newName.trim() || newName === test?.name) return;
    try {
      const response = await fetch('/api/feature_extractor/tests/' + testId, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (response.ok) {
        setTests(prev => prev.map(t => t.id === testId ? { ...t, name: newName.trim() } : t));
        setRefresh(prev => !prev);
      }
    } catch (error) { console.error('Rename error:', error); }
  };

  const handleTestClick = (test) => {
    if (test.status === 'Completed') {
      router.push(`/testing/${test.id}`);
    }
  };

  const incomingAction = (action) => {
    if (action === 'New Test') {
      setIsOpenAddTest(true);
    }
  };

  const handleClose = () => {
    setIsOpenAddTest(false);
    setRefresh((prev) => !prev);
  };

  const selectedStudy = typeof window !== 'undefined' ? localStorage.getItem('selectedStudy') : null;
  const studyMode = tests[0]?.training_session?.study?.mode || 'experiment';
  const userCanMutate = canMutate(selectedStudy, studyMode);
  const userCanDelete = canDelete(selectedStudy);

  return (
    <Layout incomingAction={incomingAction} action="New Test">
      {isOpenAddTest && <AddTest isOpen={isOpenAddTest} onClose={handleClose} />}
      {logSessionId && (
        <LogViewer sessionId={logSessionId} onClose={() => setLogSessionId(null)} />
      )}

      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model Tests</h1>
          <p className="mt-1 text-sm text-gray-500">Evaluate trained models against test datasets.</p>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={confirmAction?.type === 'delete' ? 'Delete this test?' : 'Re-test this model?'}
        description={confirmAction?.type === 'delete'
          ? `This will permanently delete "${confirmAction?.name}" and all results.`
          : `This will re-run "${confirmAction?.name}" and replace previous results.`}
        confirmLabel={confirmAction?.type === 'delete' ? 'Delete' : 'Re-test'}
        confirmTone={confirmAction?.type === 'delete' ? 'danger' : 'primary'}
        reasons={confirmAction?.type === 'retest' ? [
          { value: 'config_fix', label: 'Configuration fix' },
          { value: 'data_update', label: 'Dataset was updated' },
          { value: 'reproduce', label: 'Reproduce previous results' },
        ] : undefined}
        onConfirm={({ reason } = {}) => {
          const action = confirmAction;
          setConfirmAction(null);
          if (!action) return;
          if (action.type === 'delete') handleDelete(action.id);
          if (action.type === 'retest') handleRetest(action.id);
        }}
        onClose={() => setConfirmAction(null)}
      />

      {/* Show Archived toggle */}
      <div className="flex items-center justify-end mb-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show archived
        </label>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-visible">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Test Name</th>
              <th className="px-4 py-3.5 text-right text-sm font-semibold text-gray-900">Images</th>
              <th className="px-4 py-3.5 text-right text-sm font-semibold text-gray-900">Accuracy</th>
              <th className="px-4 py-3.5 text-right text-sm font-semibold text-gray-900">Confidence</th>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
              <th className="sticky right-0 bg-gray-50 px-4 py-3.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <TableSpinnerRow colSpan={4} />
            ) : tests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <ClipboardDocumentCheckIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No tests yet</h3>
                </td>
              </tr>
            ) : (
              tests.map((test) => (
                <tr
                  key={test.id}
                  className={`group ${test.status === 'Completed' ? 'cursor-pointer hover:bg-blue-50 transition-colors' : ''} ${test.archived_at ? 'opacity-50' : ''}`}
                >
                  <td className="whitespace-nowrap px-4 py-4 text-sm" onClick={() => handleTestClick(test)}><span className={getStatusBadgeClass(test.status)}>{test.status}</span></td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">
                    {editingTestId === test.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName(test.id, editingName);
                          if (e.key === 'Escape') setEditingTestId(null);
                        }}
                        onBlur={() => handleSaveName(test.id, editingName)}
                        autoFocus
                        className="w-full rounded border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5" onClick={() => handleTestClick(test)}>
                        {test.name}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTestId(test.id);
                            setEditingName(test.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200"
                        >
                          <PencilIcon className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-right text-gray-500 tabular-nums" onClick={() => handleTestClick(test)}>{test.num_images || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-right tabular-nums" onClick={() => handleTestClick(test)}>
                    {test.accuracy != null ? <span className={test.accuracy >= 80 ? 'text-green-700 font-medium' : test.accuracy >= 60 ? 'text-yellow-700 font-medium' : 'text-red-700 font-medium'}>{test.accuracy}%</span> : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-right text-gray-500 tabular-nums" onClick={() => handleTestClick(test)}>{test.avg_confidence != null ? test.avg_confidence + '%' : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500" onClick={() => handleTestClick(test)}>{new Date(test.created_at).toLocaleString()}</td>
                  <td className={`sticky right-0 bg-white group-hover:bg-blue-50 whitespace-nowrap px-4 py-4 text-right text-sm ${openMenuId === test.id ? "z-30" : ""}`}>
                    <div className="relative inline-block text-left" ref={openMenuId === test.id ? menuRef : null}>
                      <button
                        type="button"
                        className="rounded-full p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === test.id ? null : test.id);
                        }}
                      >
                        <EllipsisVerticalIcon className="h-6 w-6" />
                      </button>
                      {openMenuId === test.id && (
                        <div className="absolute right-0 z-50 mt-1 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5">
                          <div className="py-1">
                            {userCanMutate && (test.status === 'Completed' || test.status === 'Failed') && (
                              <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setConfirmAction({ type: 'retest', id: test.id, name: test.name }); }}>
                                Re-test
                              </button>
                            )}
                            {userCanMutate && (test.status === 'Testing' || test.status === 'Pending') && (
                              <button className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                onClick={(e) => { e.stopPropagation(); handleStop(test.id); }}>
                                Stop
                              </button>
                            )}
                            {userCanMutate && (
                            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                              onClick={(e) => { e.stopPropagation(); handleClone(test.id); }}>
                              Clone
                            </button>
                            )}
                            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                              onClick={(e) => { e.stopPropagation(); handleShowLogs(test); }}>
                              Logs
                            </button>
                            {userCanDelete && (
                            <button className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setConfirmAction({ type: 'delete', id: test.id, name: test.name }); }}>
                              Delete
                            </button>
                            )}
                            {!userCanDelete && userCanMutate && !test.archived_at && (
                            <button className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                              onClick={(e) => { e.stopPropagation(); handleArchive(test.id); }}>
                              Archive
                            </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
