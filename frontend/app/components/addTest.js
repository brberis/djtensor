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
import { XMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import theme from '../theme';

export default function AddTest({ isOpen, onClose }) {
  const [open, setOpen] = useState(isOpen);
  const [alert, setAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [datasets, setDatasets] = useState([]);
  const [models, setModels] = useState([]);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const selectedStudy = localStorage.getItem('selectedStudy');
        const [datasetsData, modelsData] = await Promise.all([
          fetch(`/api/datasets/dataset/?study=${selectedStudy}&for_testing=true`).then(res => res.json()),
          fetch(`/api/models/model/?study=${selectedStudy}`).then(res => res.json()),
        ]);
        setDatasets(datasetsData);
        setModels(modelsData);
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

  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const selectedStudy = localStorage.getItem('selectedStudy');

    const newTest = {
      study: selectedStudy,
      name: formData.get('name'),
      dataset: formData.get('dataset'),
      model: formData.get('model'),
      description: formData.get('description'),
    };

    setIsLoading(true);
    try {
      const response = await fetch('/api/tests/test/', {
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
        setAlert(data.detail);
      }
    } catch (error) {
      console.error('Failed to create test:', error);
      setAlert('Failed to create test');
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

                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Create New Test
                    </Dialog.Title>

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
                          <label htmlFor="model" className={theme.classes.label}>Model</label>
                          <select id="model" name="model" required className={`mt-1.5 ${theme.classes.select}`}>
                            <option value="">Select a model...</option>
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
                  </div>
                </div>

                <div className="mt-6 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                  <button type="button" onClick={() => handleClose(false)} className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0">
                    Cancel
                  </button>
                  <button type="submit" form="add-test-form" className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2">
                    Create Test
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
