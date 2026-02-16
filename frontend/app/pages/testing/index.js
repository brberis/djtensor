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
import ConfirmDialog from '../../components/ConfirmDialog';
import { TableSpinnerRow } from '../../components/Spinner';
import { getStatusBadgeClass } from '../../theme';
import { ClipboardDocumentCheckIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';

export default function Testing() {
  const [tests, setTests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddTest, setIsOpenAddTest] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const menuRef = useRef(null);
  const router = useRouter();

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
        const response = await fetch('/api/feature_extractor/tests/');
        const data = await response.json();

        if (!Array.isArray(data)) throw new Error('Data is not an array');

        const savedStudy = localStorage.getItem('selectedStudy');
        const filteredData = savedStudy
          ? data.filter((test) => test.training_session?.study?.id == savedStudy)
          : data;

        const sortedData = filteredData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        setTests(sortedData);
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
  }, [refresh]);

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

  return (
    <Layout incomingAction={incomingAction} action="New Test">
      {isOpenAddTest && <AddTest isOpen={isOpenAddTest} onClose={handleClose} />}

      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model Tests</h1>
          <p className="mt-1 text-sm text-gray-500">Evaluate trained models against test datasets.</p>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'delete' ? 'Delete this test?' : 'Re-test this model?'}
        description={confirmAction?.type === 'delete'
          ? `This will permanently delete "${confirmAction?.name}" and all results.`
          : `This will re-run "${confirmAction?.name}" and replace previous results.`}
        confirmLabel={confirmAction?.type === 'delete' ? 'Delete' : 'Re-test'}
        confirmTone={confirmAction?.type === 'delete' ? 'danger' : 'primary'}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (!action) return;
          if (action.type === 'delete') handleDelete(action.id);
          if (action.type === 'retest') handleRetest(action.id);
        }}
        onClose={() => setConfirmAction(null)}
      />

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-visible">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Test Name</th>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
              <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
              <th className="sticky right-0 bg-gray-50 px-4 py-3.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <TableSpinnerRow colSpan={4} />
            ) : tests.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <ClipboardDocumentCheckIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No tests yet</h3>
                </td>
              </tr>
            ) : (
              tests.map((test) => (
                <tr
                  key={test.id}
                  onClick={() => handleTestClick(test)}
                  className={test.status === 'Completed' ? 'group cursor-pointer hover:bg-teal-50 transition-colors' : 'group'}
                >
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">{test.name}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">{new Date(test.created_at).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm"><span className={getStatusBadgeClass(test.status)}>{test.status}</span></td>
                  <td className="sticky right-0 bg-white group-hover:bg-teal-50 whitespace-nowrap px-4 py-4 text-right text-sm">
                    <div className="relative inline-block text-left" ref={openMenuId === test.id ? menuRef : null}>
                      <button
                        type="button"
                        className="rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === test.id ? null : test.id);
                        }}
                      >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                      </button>
                      {openMenuId === test.id && (
                        <div className="absolute right-0 z-10 mt-1 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5">
                          {(test.status === 'Completed' || test.status === 'Failed') && (
                            <button
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmAction({ type: 'retest', id: test.id, name: test.name });
                              }}
                            >
                              Re-test
                            </button>
                          )}
                          <button
                            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmAction({ type: 'delete', id: test.id, name: test.name });
                            }}
                          >
                            Delete
                          </button>
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
