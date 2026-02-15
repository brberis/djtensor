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

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddTest from '../../components/addTest';
import { TableSpinnerRow } from '../../components/Spinner';
import { getStatusBadgeClass } from '../../theme';
import { ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';

export default function Testing() {
  const [tests, setTests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddTest, setIsOpenAddTest] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchTests = async () => {
      try {
        const response = await fetch('/api/feature_extractor/tests/');
        const data = await response.json();
        const sortedData = data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        if (Array.isArray(sortedData)) {
          const savedStudy = localStorage.getItem('selectedStudy');
          const filteredData = savedStudy
            ? sortedData.filter(test => test.training_session.study.id == savedStudy)
            : sortedData;

          setTests(filteredData);
        } else {
          throw new Error('Data is not an array');
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch tests:', error);
        setIsLoading(false);
        setTests([]);
      }
    };

    fetchTests();
    const refreshInterval = 5000;
    const intervalId = setInterval(fetchTests, refreshInterval);

    return () => clearInterval(intervalId);
  }, [refresh]);

  const handleTestClick = (test) => {
    if (test.status === 'Completed') {
      router.push(`/testing/${test.id}`);
    }
  };

  const handleClose = () => {
    setIsOpenAddTest(false);
    setRefresh((prevRefresh) => !prevRefresh);
  };

  const incomingAction = (action) => {
    if (action === 'New Test') {
      setIsOpenAddTest(true);
    }
  };

  return (
    <Layout incomingAction={incomingAction} action={'New Test'}>
      {isOpenAddTest && <AddTest isOpen={isOpenAddTest} onClose={handleClose} />}

      {/* Page header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model Tests</h1>
          <p className="mt-1 text-sm text-gray-500">
            Evaluate trained models against test datasets. Click a completed test for results.
          </p>
        </div>
      </div>

      {/* Tests table */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Test Name</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <TableSpinnerRow colSpan={3} />
            ) : tests.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center">
                  <ClipboardDocumentCheckIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No tests yet</h3>
                  <p className="mt-1 text-sm text-gray-500">Create a new test to evaluate your models.</p>
                </td>
              </tr>
            ) : (
              tests.map((test) => (
                <tr
                  key={test.id}
                  onClick={() => handleTestClick(test)}
                  className={test.status === 'Completed' ? 'cursor-pointer hover:bg-teal-50 transition-colors' : ''}
                >
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">{test.name}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                    {new Date(test.created_at).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm">
                    <span className={getStatusBadgeClass(test.status)}>{test.status}</span>
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
