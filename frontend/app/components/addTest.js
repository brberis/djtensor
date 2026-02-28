/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: addTest.js
 * Copyright (c) 2024
 */

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, ExclamationCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import theme from '../theme';

export default function AddTest({ isOpen, onClose }) {
  const [open, setOpen] = useState(isOpen);
  const [alert, setAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [datasets, setDatasets] = useState([]);
  const [models, setModels] = useState([]);

  // Tab state
  const [tab, setTab] = useState('single');

  // Batch state
  const [batchPrefix, setBatchPrefix] = useState('');
  const [batchDataset, setBatchDataset] = useState('');
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, errors, done }

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const selectedStudy = localStorage.getItem('selectedStudy');
        const [datasetsData, modelsData] = await Promise.all([
          fetch(`/api/datasets/dataset/?study=${selectedStudy}&for_testing=true`).then(res => res.json()),
          fetch(`/api/feature_extractor/trainingsession/?status=Completed`).then(res => res.json()),
        ]);
        setDatasets(Array.isArray(datasetsData) ? datasetsData : []);
        const filtered = Array.isArray(modelsData) ? modelsData.filter(s => s.study?.id == selectedStudy) : [];
        setModels(filtered);
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

  // --- Single test submit (unchanged) ---
  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);

    const newTest = {
      name: formData.get('name'),
      dataset: formData.get('dataset'),
      training_session_id: formData.get('model'),
      notes: formData.get('description'),
    };

    setIsLoading(true);
    try {
      const response = await fetch('/api/feature_extractor/tests/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newTest),
      });
      if (response.ok) {
        setIsLoading(false);
        handleClose(true);
      } else {
        const data = await response.json();
        const msg = data.detail || Object.entries(data).map(([k,v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('; ');
        setAlert(msg);
      }
    } catch (error) {
      console.error('Failed to create test:', error);
      setAlert('Failed to create test');
      setIsLoading(false);
    }
  };

  // --- Batch test submit ---
  const batchFormHandler = async (e) => {
    e.preventDefault();
    setAlert(null);

    if (!batchPrefix.trim()) {
      setAlert('Name prefix is required');
      return;
    }
    if (!batchDataset) {
      setAlert('Please select a dataset');
      return;
    }
    if (selectedSessions.length === 0) {
      setAlert('Please select at least one training session');
      return;
    }

    const total = selectedSessions.length;
    setBatchProgress({ current: 0, total, errors: [], done: false });

    let errors = [];
    for (let i = 0; i < selectedSessions.length; i++) {
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));

      const testName = `${batchPrefix.trim()} T-${i + 1}`;
      try {
        const response = await fetch('/api/feature_extractor/tests/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: testName,
            dataset: batchDataset,
            training_session_id: selectedSessions[i],
          }),
        });
        if (!response.ok) {
          const data = await response.json();
          const msg = data.detail || Object.entries(data).map(([k,v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('; ');
          errors.push(`${testName}: ${msg}`);
        }
      } catch (error) {
        errors.push(`${testName}: Network error`);
      }
    }

    setBatchProgress({ current: total, total, errors, done: true });

    // Close after a short delay on success
    if (errors.length === 0) {
      setTimeout(() => handleClose(true), 1200);
    }
  };

  // --- Select All / toggle helpers ---
  const allSelected = models.length > 0 && selectedSessions.length === models.length;
  const someSelected = selectedSessions.length > 0 && selectedSessions.length < models.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedSessions([]);
    } else {
      setSelectedSessions(models.map(m => m.id));
    }
  };

  const toggleSession = (id) => {
    setSelectedSessions(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  if (isLoading) {
    return <Spinner timeOut={0} />;
  }

  const tabClasses = (active) =>
    `px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
      active
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    }`;

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !batchProgress && handleClose(false)}>
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
              <Dialog.Panel className={`relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full ${tab === 'batch' ? 'sm:max-w-xl' : 'sm:max-w-lg'} sm:p-6`}>
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={() => !batchProgress && handleClose(false)}
                    disabled={!!batchProgress && !batchProgress.done}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Create New Test
                    </Dialog.Title>

                    {/* Tab bar */}
                    <div className="mt-4 flex border-b border-gray-200">
                      <button type="button" className={tabClasses(tab === 'single')} onClick={() => { setTab('single'); setAlert(null); setBatchProgress(null); }}>
                        Single Test
                      </button>
                      <button type="button" className={tabClasses(tab === 'batch')} onClick={() => { setTab('batch'); setAlert(null); setBatchProgress(null); }}>
                        Batch Test
                      </button>
                    </div>

                    {alert && (
                      <div className="mt-4 rounded-md bg-red-50 p-4">
                        <div className="flex">
                          <ExclamationCircleIcon className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                          <div className="ml-3">
                            <p className="text-sm text-red-700">{alert}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ===== SINGLE TEST TAB ===== */}
                    {tab === 'single' && (
                      <form id="add-test-form" onSubmit={formHandler} className="mt-6">
                        <div className="space-y-4">
                          <div>
                            <label htmlFor="name" className={theme.classes.label}>Name</label>
                            <input id="name" name="name" type="text" required className={`mt-1.5 ${theme.classes.input}`} />
                          </div>

                          <div>
                            <label htmlFor="dataset" className={theme.classes.label}>Dataset</label>
                            <select id="dataset" name="dataset" required className={`mt-1.5 ${theme.classes.select}`}>
                              <option value="">Select a dataset...</option>
                              {datasets.map((dataset) => (
                                <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label htmlFor="model" className={theme.classes.label}>Training Session</label>
                            <select id="model" name="model" required className={`mt-1.5 ${theme.classes.select}`}>
                              <option value="">Select a training session...</option>
                              {models.map((model) => (
                                <option key={model.id} value={model.id}>{model.name}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label htmlFor="description" className={theme.classes.label}>Description</label>
                            <textarea id="description" name="description" rows={3} className={`mt-1.5 ${theme.classes.textarea}`} />
                          </div>
                        </div>
                      </form>
                    )}

                    {/* ===== BATCH TEST TAB ===== */}
                    {tab === 'batch' && (
                      <form id="batch-test-form" onSubmit={batchFormHandler} className="mt-6">
                        <div className="space-y-4">
                          {/* Name Prefix */}
                          <div>
                            <label htmlFor="batchPrefix" className={theme.classes.label}>Name Prefix</label>
                            <input
                              id="batchPrefix"
                              type="text"
                              required
                              value={batchPrefix}
                              onChange={(e) => setBatchPrefix(e.target.value)}
                              className={`mt-1.5 ${theme.classes.input}`}
                              placeholder="e.g. 150/384px Fragments FT EfficientNet"
                              disabled={!!batchProgress}
                            />
                            {batchPrefix.trim() && (
                              <p className="mt-1 text-xs text-gray-500">
                                Tests will be named: <span className="font-medium">{batchPrefix.trim()} T-1</span>, <span className="font-medium">{batchPrefix.trim()} T-2</span>, ...
                              </p>
                            )}
                          </div>

                          {/* Dataset */}
                          <div>
                            <label htmlFor="batchDataset" className={theme.classes.label}>Dataset</label>
                            <select
                              id="batchDataset"
                              required
                              value={batchDataset}
                              onChange={(e) => setBatchDataset(e.target.value)}
                              className={`mt-1.5 ${theme.classes.select}`}
                              disabled={!!batchProgress}
                            >
                              <option value="">Select a dataset...</option>
                              {datasets.map((dataset) => (
                                <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                              ))}
                            </select>
                          </div>

                          {/* Training Sessions multi-select */}
                          <div>
                            <label className={theme.classes.label}>
                              Training Sessions
                              {selectedSessions.length > 0 && (
                                <span className="ml-2 text-xs font-normal text-gray-500">
                                  {selectedSessions.length} of {models.length} selected
                                </span>
                              )}
                            </label>

                            {models.length === 0 ? (
                              <p className="mt-2 text-sm text-gray-500">No completed training sessions available.</p>
                            ) : (
                              <div className="mt-1.5 rounded-md ring-1 ring-inset ring-gray-300 overflow-hidden">
                                {/* Select All header */}
                                <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200">
                                  <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                                    onChange={toggleSelectAll}
                                    className={theme.classes.checkbox}
                                    disabled={!!batchProgress}
                                  />
                                  <span className="text-sm font-medium text-gray-700">Select All</span>
                                </div>

                                {/* Session list */}
                                <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                                  {models.map((model) => (
                                    <label
                                      key={model.id}
                                      className={`flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer transition-colors ${
                                        selectedSessions.includes(model.id) ? 'bg-blue-50/50' : ''
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedSessions.includes(model.id)}
                                        onChange={() => toggleSession(model.id)}
                                        className={theme.classes.checkbox}
                                        disabled={!!batchProgress}
                                      />
                                      <span className="text-sm text-gray-900 truncate flex-1">{model.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Preview */}
                          {selectedSessions.length > 0 && batchPrefix.trim() && (
                            <div className="rounded-md bg-blue-50 p-3">
                              <p className="text-sm font-medium text-blue-800">
                                Will create {selectedSessions.length} test{selectedSessions.length !== 1 ? 's' : ''}
                              </p>
                              <div className="mt-1 space-y-0.5">
                                {selectedSessions.slice(0, 3).map((_, i) => (
                                  <p key={i} className="text-xs text-blue-600">
                                    {batchPrefix.trim()} T-{i + 1}
                                  </p>
                                ))}
                                {selectedSessions.length > 3 && (
                                  <p className="text-xs text-blue-500">
                                    ... and {selectedSessions.length - 3} more
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Batch progress */}
                          {batchProgress && (
                            <div className="rounded-md p-4 space-y-2">
                              {!batchProgress.done ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                    </svg>
                                    <p className="text-sm font-medium text-gray-700">
                                      Creating test {batchProgress.current} of {batchProgress.total}...
                                    </p>
                                  </div>
                                  <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                      style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <>
                                  {batchProgress.errors.length === 0 ? (
                                    <div className="flex items-center gap-2">
                                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                                      <p className="text-sm font-medium text-green-700">
                                        Successfully created {batchProgress.total} test{batchProgress.total !== 1 ? 's' : ''}!
                                      </p>
                                    </div>
                                  ) : (
                                    <div>
                                      <p className="text-sm font-medium text-yellow-700">
                                        Created {batchProgress.total - batchProgress.errors.length} of {batchProgress.total} tests.
                                      </p>
                                      <div className="mt-2 space-y-1">
                                        {batchProgress.errors.map((err, i) => (
                                          <p key={i} className="text-xs text-red-600">{err}</p>
                                        ))}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleClose(true)}
                                        className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-500"
                                      >
                                        Close
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                {!batchProgress && (
                  <div className="mt-6 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                    <button type="button" onClick={() => handleClose(false)} className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0">
                      Cancel
                    </button>
                    {tab === 'single' ? (
                      <button type="submit" form="add-test-form" className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2">
                        Create Test
                      </button>
                    ) : (
                      <button
                        type="submit"
                        form="batch-test-form"
                        disabled={selectedSessions.length === 0 || !batchPrefix.trim() || !batchDataset}
                        className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm sm:col-start-2 ${
                          selectedSessions.length > 0 && batchPrefix.trim() && batchDataset
                            ? 'bg-blue-600 hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
                            : 'bg-gray-300 cursor-not-allowed'
                        }`}
                      >
                        Create {selectedSessions.length || ''} Test{selectedSessions.length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
