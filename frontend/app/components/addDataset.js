/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: addDataset.js
 * Copyright (c) 2024
 */

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import theme from '../theme';

const resolutions = [
  { res: '224', des: '224x224' },
  { res: '384', des: '384x384' },
  { res: '512', des: '512x512' },
];

export default function AddDataset({ isOpen, onClose }) {
  const [open, setOpen] = useState(isOpen);
  const [alert, setAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [labels, setLabels] = useState([]);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [base, setBase] = useState(false);
  const [forTesting, setForTesting] = useState(false);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const baseParam = queryParams.get('base');
    setBase(baseParam === 'true');
    setForTesting(baseParam !== 'true');

    async function fetchData() {
      setIsLoading(true);
      try {
        const [labelsData] = await Promise.all([
          fetch(`/api/datasets/label/`).then(res => res.json()),
        ]);
        setLabels(labelsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleClose = (result) => {
    setOpen(false);
    onClose(result);
  };

  const toggleLabel = (labelId) => {
    setSelectedLabels(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };

  const toggleAll = () => {
    if (selectedLabels.length === labels.length) {
      setSelectedLabels([]);
    } else {
      setSelectedLabels(labels.map(l => l.id.toString()));
    }
  };

  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const selectedStudy = localStorage.getItem('selectedStudy');

    const newDataset = {
      study: selectedStudy,
      name: formData.get('name'),
      labels: selectedLabels,
      description: formData.get('description'),
      resolution: formData.get('resolution'),
      base: base,
      for_testing: formData.get('forTesting') === 'on' ? true : false,
    };

    setIsLoading(true);
    try {
      const response = await fetch('/api/datasets/dataset/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newDataset),
      });
      if (response.ok) {
        setIsLoading(false);
        handleClose(true);
      } else {
        const data = await response.json();
        setAlert(data.detail);
      }
    } catch (error) {
      console.error('Failed to create dataset:', error);
      setAlert('Failed to create dataset');
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <Spinner timeOut={0} />;
  }

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => handleClose(false)}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                {/* Close button */}
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={() => handleClose(false)}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                  Create New Dataset
                </Dialog.Title>

                {/* Alert */}
                {alert && (
                  <div className="mt-3 rounded-md bg-red-50 p-4">
                    <div className="flex">
                      <ExclamationCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                      <div className="ml-3">
                        <p className="text-sm text-red-700">{alert}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <form id="add-dataset-form" onSubmit={formHandler} className="space-y-4">
                    {/* Name */}
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium leading-6 text-gray-900">
                        Name
                      </label>
                      <input
                        type="text"
                        name="name"
                        id="name"
                        required
                        className="mt-1 block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium leading-6 text-gray-900">
                        Description
                      </label>
                      <textarea
                        name="description"
                        id="description"
                        rows={3}
                        className="mt-1 block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                      />
                    </div>

                    {/* Resolution */}
                    <div>
                      <label htmlFor="resolution" className="block text-sm font-medium leading-6 text-gray-900">
                        Resolution
                      </label>
                      <select
                        name="resolution"
                        id="resolution"
                        className="mt-1 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                      >
                        {resolutions.map((resolution) => (
                          <option key={resolution.res} value={resolution.res}>
                            {resolution.des}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Labels - Checkbox list */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium leading-6 text-gray-900">
                          Labels
                        </label>
                        {labels.length > 0 && (
                          <button
                            type="button"
                            onClick={toggleAll}
                            className="text-xs text-blue-600 hover:text-blue-500"
                          >
                            {selectedLabels.length === labels.length ? 'Deselect All' : 'Select All'}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 max-h-48 overflow-y-auto rounded-md ring-1 ring-inset ring-gray-300">
                        {labels.length === 0 && (
                          <p className="px-3 py-2 text-sm text-gray-500">No labels available</p>
                        )}
                        {labels.map((label) => (
                          <label
                            key={label.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLabels.includes(label.id.toString())}
                              onChange={() => toggleLabel(label.id.toString())}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{label.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {!base && (
                      <div className="flex items-center gap-2">
                        <input
                          id="forTesting"
                          name="forTesting"
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor="forTesting" className="text-sm text-gray-700">For testing only</label>
                      </div>
                    )}
                  </form>
                </div>

                <div className="mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => handleClose(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="add-dataset-form"
                    className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2"
                  >
                    Create Dataset
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
