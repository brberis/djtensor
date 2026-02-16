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

import { useEffect, useState, useRef, Fragment } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddSession from '../../components/addTrainingSession';
import LogViewer from '../../components/LogViewer';
import ConfirmDialog from '../../components/ConfirmDialog';
import { TableSpinnerRow } from '../../components/Spinner';
import { getStatusBadgeClass } from '../../theme';
import { CpuChipIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';

export default function Training() {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddSession, setIsOpenAddSession] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [logSessionId, setLogSessionId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const menuRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/feature_extractor/trainingsession/');
        const data = await response.json();
        if (Array.isArray(data)) {
          const savedStudy = localStorage.getItem('selectedStudy');
          const filteredData = savedStudy ? data.filter(session => session.study?.id == savedStudy) : data;
          const sortedData = filteredData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          setSessions(sortedData);
        } else {
          throw new Error('Data is not an array');
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
        setIsLoading(false);
        setSessions([]);
      }
    };

    fetchSessions();
    const refreshInterval = 5000;
    const intervalId = setInterval(fetchSessions, refreshInterval);

    return () => clearInterval(intervalId);
  }, [refresh]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSessionClick = (session) => {
    if (session.status === 'Completed') {
      router.push(`/training/${session.id}`);
    }
  };

  const handleClose = () => {
    setIsOpenAddSession(false);
    setRefresh((prevRefresh) => !prevRefresh);
  };

  const incomingAction = (action) => {
    if (action === 'New Training Session') {
      setIsOpenAddSession(true);
    }
  };

  const getCsrfToken = () => {
    return document.cookie.match(/csrftoken=([^;]*)/)?.[1] || '';
  };

  const handleRetrain = async (sessionId) => {
    setOpenMenuId(null);
    try {
      const response = await fetch(`/api/feature_extractor/trainingsession/${sessionId}/retrain/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken(),
        },
      });
      if (response.ok) {
        setRefresh((prev) => !prev);
      } else {
        console.error('Retrain failed:', await response.text());
      }
    } catch (error) {
      console.error('Retrain error:', error);
    }
  };

  const handleStop = async (sessionId) => {
    setOpenMenuId(null);
    try {
      const response = await fetch(`/api/feature_extractor/trainingsession/${sessionId}/stop/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken(),
        },
      });
      if (response.ok) {
        setRefresh((prev) => !prev);
      } else {
        console.error('Stop failed:', await response.text());
      }
    } catch (error) {
      console.error('Stop error:', error);
    }
  };


  const handleDelete = async (sessionId) => {
    setOpenMenuId(null);
    try {
      const response = await fetch(`/api/feature_extractor/trainingsession/${sessionId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRFToken': getCsrfToken(),
        },
      });
      if (response.ok) {
        setRefresh((prev) => !prev);
      } else {
        console.error('Delete failed:', await response.text());
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const handleShowLogs = (sessionId) => {
    setOpenMenuId(null);
    setLogSessionId(sessionId);
  };

  const isTerminal = (status) => status === 'Completed' || status === 'Failed';
  const isActive = (status) => status === 'Training' || status === 'Pending';

  return (
    <Layout incomingAction={incomingAction} action={'New Training Session'}>
      {isOpenAddSession && <AddSession isOpen={isOpenAddSession} onClose={handleClose} />}
      {logSessionId && (
        <LogViewer
          sessionId={logSessionId}
          onClose={() => setLogSessionId(null)}
        />
      )}

      {/* Page header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Sessions</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and manage model training sessions. Click a completed session for details.
          </p>
        </div>
      </div>



      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === "retrain" ? "Re-train this session?" : "Delete this training session?"}
        description={confirmAction?.type === "retrain"
          ? `This will start a new training run for "${confirmAction?.name}".`
          : `This will permanently delete "${confirmAction?.name}" and all associated data. This cannot be undone.`}
        confirmLabel={confirmAction?.type === "retrain" ? "Re-train" : "Delete"}
        confirmTone={confirmAction?.type === "delete" ? "danger" : "primary"}
        requireText={confirmAction?.type === "delete" ? confirmAction?.name : undefined}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (!action) return;
          if (action.type === "retrain") handleRetrain(action.id);
          if (action.type === "delete") handleDelete(action.id);
        }}
        onClose={() => setConfirmAction(null)}
      />

      {/* Sessions table */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Session Name</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Model</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Dataset</th>
              <th scope="col" className="sticky right-0 bg-gray-50 px-4 py-3.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <TableSpinnerRow colSpan={6} />
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <CpuChipIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No training sessions</h3>
                  <p className="mt-1 text-sm text-gray-500">Create a new training session to get started.</p>
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr
                  key={session.id}
                  className={session.status === 'Completed' ? 'group cursor-pointer hover:bg-teal-50 transition-colors' : 'group'}
                >
                  <td className="whitespace-nowrap px-4 py-4 text-sm">
                    <span className={getStatusBadgeClass(session.status)}>{session.status}</span>
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900"
                    onClick={() => handleSessionClick(session)}
                  >
                    {session.name}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-sm text-gray-500"
                    onClick={() => handleSessionClick(session)}
                  >
                    {new Date(session.created_at).toLocaleString()}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-sm text-gray-500"
                    onClick={() => handleSessionClick(session)}
                  >
                    {session.model.name}
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-4 text-sm text-gray-500"
                    onClick={() => handleSessionClick(session)}
                  >
                    {session.dataset.name}
                  </td>
                  <td className="sticky right-0 bg-white group-hover:bg-teal-50 whitespace-nowrap px-4 py-4 text-right text-sm">
                    <div className="relative inline-block text-left" ref={openMenuId === session.id ? menuRef : null}>
                      <button
                        type="button"
                        className="rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === session.id ? null : session.id);
                        }}
                      >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                      </button>

                      {openMenuId === session.id && (
                        <div className="absolute right-0 z-10 mt-1 w-36 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
                          <div className="py-1">
                            {isTerminal(session.status) && (
                              <button
                                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmAction({ type: "retrain", id: session.id, name: session.name });
                                }}
                              >
                                Re-train
                              </button>
                            )}
                            {isActive(session.status) && (
                              <button
                                className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStop(session.id);
                                }}
                              >
                                Stop
                              </button>
                            )}
                            <button
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShowLogs(session.id);
                              }}
                            >
                              Logs
                            </button>
                            
                              <button
                                className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                  setConfirmAction({ type: "delete", id: session.id, name: session.name });
                                }}
                              >
                                Delete
                              </button>

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
