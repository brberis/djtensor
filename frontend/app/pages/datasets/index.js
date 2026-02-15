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
import AddDataset from '../../components/addDataset';
import GenerateDataset from '../../components/generateDataset';
import { TableSpinnerRow } from '../../components/Spinner';
import { CircleStackIcon } from '@heroicons/react/24/outline';

export default function Datasets({ base }) {
  const [datasets, setDatasets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddDataset, setIsOpenAddDataset] = useState(false);
  const [isOpenGenerateDataset, setIsOpenGenerateDataset] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [action, setAction] = useState('');
  const [baseSet, setBaseSet] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const baseDatasets = datasets.filter(dataset => dataset.base);
    if (baseDatasets.length > 0) {
      setBaseSet(true);
    }
  }, [datasets]);

  // Fetch datasets from API
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await fetch('/api/datasets/dataset/');
        const data = await response.json();
        const selectedStudy = localStorage.getItem('selectedStudy');

        const filteredDatasets = data.filter(dataset =>
          dataset.study == selectedStudy || dataset.shared.includes(parseInt(selectedStudy))
        );

        setDatasets(filteredDatasets);
      } catch (error) {
        console.error('Failed to fetch datasets:', error);
        setDatasets([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDatasets();
  }, [refresh, base]);

  useEffect(() => {
    if (!baseSet) {
      setAction('Create Base Dataset');
    } else {
      setAction('Generate Datasets');
    }
  }, [baseSet]);

  const handleDatasetClick = (dataset) => {
    router.push(`/datasets/${dataset.id}`);
  };

  const handleClose = () => {
    setIsOpenAddDataset(false);
    setIsOpenGenerateDataset(false);
    setRefresh(prev => !prev);
  };

  const incomingAction = async (action) => {
    if (action === 'Create Base Dataset') {
      setIsOpenAddDataset(true);
    }
    if (action === 'Generate Datasets') {
      try {
        setIsOpenGenerateDataset(true);
      } catch (error) {
        console.error('Failed to fetch datasets:', error);
        setDatasets([]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const getDatasetType = (dataset) => {
    if (dataset.base) return 'Base';
    if (dataset.for_testing) return 'Testing';
    return 'Training';
  };

  const getTypeBadge = (dataset) => {
    const type = getDatasetType(dataset);
    const styles = {
      Base: 'bg-purple-50 text-purple-700 ring-purple-700/10',
      Testing: 'bg-amber-50 text-amber-700 ring-amber-600/20',
      Training: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    };
    return (
      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles[type]}`}>
        {type}
      </span>
    );
  };

  return (
    <Layout incomingAction={incomingAction} action={action}>
      {isOpenAddDataset && <AddDataset isOpen={isOpenAddDataset} onClose={handleClose} />}
      {isOpenGenerateDataset && <GenerateDataset isOpen={isOpenGenerateDataset} onClose={handleClose} />}

      {/* Page header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Datasets</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your image datasets for training and testing models.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Name</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Description</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Resolution</th>
              <th scope="col" className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <TableSpinnerRow colSpan={4} />
            ) : datasets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <CircleStackIcon className="mx-auto h-12 w-12 text-gray-300" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No datasets</h3>
                  <p className="mt-1 text-sm text-gray-500">Get started by creating a base dataset.</p>
                </td>
              </tr>
            ) : (
              datasets.map((dataset) => (
                <tr
                  key={dataset.id}
                  onClick={() => handleDatasetClick(dataset)}
                  className="cursor-pointer hover:bg-teal-50 transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">{dataset.name}</td>
                  <td className="px-4 py-4 text-sm text-gray-500 max-w-xs truncate">{dataset.description}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">{dataset.resolution}px</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm">{getTypeBadge(dataset)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const base = context.query.base === 'true';
  return { props: { base } };
}
