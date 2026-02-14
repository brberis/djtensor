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
  const [trainingSession, setTrainingSession] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const selectedStudy = localStorage.getItem('selectedStudy');

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/feature_extractor/trainingsession/');
        const data = await response.json();
        const filteredData = data.filter(dataset => {
          return dataset.study.id.toString() === selectedStudy;
        });
        setTrainingSession(filteredData);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setIsLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await fetch('/api/datasets/dataset/');
        const data = await response.json();
        const filteredData = data.filter(dataset => {
          return dataset.shared.some(sharedStudy => sharedStudy.toString() === selectedStudy) &&
                 dataset.for_testing;
        });
        setDatasets(filteredData);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setIsLoading(false);
      }
    };

    fetchDatasets();
  }, []);

  const handleClose = (result) => {
    setOpen(false);
    onClose(result);
  };

  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const newTest = {
      name: formData.get('name'),
      notes: formData.get('notes'),
      dataset: formData.get('dataset'),
      training_session: formData.get('trainingsession'),
      training_session_id: formData.get('trainingsession'),
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
        handleClose(true);
      } else {
        const data = await response.json();
        setAlert(data.detail);
      }
    } catch (error) {
      console.error('Failed to create a test:', error);
      setAlert('Failed to create test');
    }
  };

  if (isLoading) {
    return <Spinner timeOut={0} />;
  }

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
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
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-xl bg-white shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                {/* Header */}
                <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    New Test
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none"
                    onClick={handleClose}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5">
                  {alert && (
                    <div className="mb-4 rounded-md bg-red-50 p-4">
                      <div className="flex">
                        <ExclamationCircleIcon className="h-5 w-5 text-red-400" />
                        <p className="ml-3 text-sm font-medium text-red-800">{alert}</p>
                      </div>
                    </div>
                  )}
                  <form id="add-test-form" onSubmit={formHandler}>
                    <div className="space-y-5">
                      <div>
                        <label htmlFor="name" className={theme.classes.label}>Name</label>
                        <input id="name" name="name" type="text" required className={`mt-1.5 ${theme.classes.input}`} />
                      </div>

                      <div>
                        <label htmlFor="trainingsession" className={theme.classes.label}>Training Session</label>
                        <select id="trainingsession" name="trainingsession" required className={`mt-1.5 ${theme.classes.select}`}>
                          <option value="" disabled>Select a training...</option>
                          {trainingSession?.map((training) => (
                            <option key={training.id} value={training.id}>{training.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="dataset" className={theme.classes.label}>Dataset to Test</label>
                        <select id="dataset" name="dataset" required className={`mt-1.5 ${theme.classes.select}`}>
                          <option value="" disabled>Select a dataset...</option>
                          {datasets?.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="notes" className={theme.classes.label}>Notes</label>
                        <textarea id="notes" name="notes" rows={3} className={`mt-1.5 ${theme.classes.textarea}`} />
                      </div>
                    </div>
                  </form>
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                  <button type="button" onClick={handleClose} className={theme.classes.btnSecondary}>
                    Cancel
                  </button>
                  <button type="submit" form="add-test-form" className={theme.classes.btnPrimary}>
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
