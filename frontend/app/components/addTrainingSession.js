/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: addTrainingSession.js
 * Copyright (c) 2024
 */

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import theme from '../theme';

export default function AddSession({ isOpen, onClose }) {
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
          fetch(`/api/datasets/dataset/?study=${selectedStudy}`).then(res => res.json()),
          fetch(`/api/feature_extractor/tfmodel/`).then(res => res.json()),
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

    const newSession = {
      study_id: selectedStudy,
      name: formData.get('name'),
      dataset_id: formData.get('dataset'),
      model_id: formData.get('model'),
      notes: formData.get('description'),
      batch_size: parseInt(formData.get('batchSize'), 10),
      num_epochs: parseInt(formData.get('epochs'), 10),
      learning_rate: parseFloat(formData.get('learningRate')),
    };

    setIsLoading(true);
    try {
      const response = await fetch('/api/feature_extractor/trainingsession/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSession),
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
      console.error('Failed to create training session:', error);
      setAlert('Failed to create training session');
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

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-lg transform rounded-lg bg-white px-6 pb-6 pt-5 shadow-xl transition-all sm:p-8">
                <div className="absolute right-4 top-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={() => handleClose(false)}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                  New Training Session
                </Dialog.Title>

                <div className="mt-4">
                  {alert && (
                    <div className="mb-4 rounded-md bg-red-50 p-4">
                      <div className="flex">
                        <ExclamationCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                        <p className="ml-3 text-sm text-red-700">{alert}</p>
                      </div>
                    </div>
                  )}

                  <form id="add-training-form" onSubmit={formHandler}>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="name" className={theme.classes.label}>Name</label>
                        <input id="name" name="name" type="text" required className={`mt-1.5 ${theme.classes.input}`} />
                      </div>

                      <div>
                        <label htmlFor="dataset" className={theme.classes.label}>Dataset</label>
                        <select id="dataset" name="dataset" required className={`mt-1.5 ${theme.classes.select}`}>
                          <option value="">Select a dataset</option>
                          {datasets.map((ds) => (
                            <option key={ds.id} value={ds.id}>{ds.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="model" className={theme.classes.label}>Model</label>
                        <select id="model" name="model" required className={`mt-1.5 ${theme.classes.select}`}>
                          <option value="">Select a model</option>
                          {models.map((model) => (
                            <option key={model.id} value={model.id}>{model.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="batchSize" className={theme.classes.label}>Batch Size</label>
                          <input id="batchSize" name="batchSize" type="number" required defaultValue="16" className={`mt-1.5 ${theme.classes.input}`} />
                        </div>
                        <div>
                          <label htmlFor="epochs" className={theme.classes.label}>Epochs</label>
                          <input id="epochs" name="epochs" type="number" required defaultValue="20" className={`mt-1.5 ${theme.classes.input}`} />
                        </div>
                        <div>
                          <label htmlFor="learningRate" className={theme.classes.label}>Learning Rate</label>
                          <input id="learningRate" name="learningRate" type="text" required defaultValue="0.005" className={`mt-1.5 ${theme.classes.input}`} />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="description" className={theme.classes.label}>Description</label>
                        <textarea id="description" name="description" rows={3} className={`mt-1.5 ${theme.classes.textarea}`} />
                      </div>
                    </div>
                  </form>
                </div>

                <div className="mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                  <button type="button" onClick={() => handleClose(false)} className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0">
                    Cancel
                  </button>
                  <button type="submit" form="add-training-form" className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2">
                    Create Session
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
