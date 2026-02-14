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
  const [base, setBase] = useState(false);
  const [forTesting, setForTesting] = useState(false);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const baseParam = queryParams.get('base');
    setBase(true);
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

  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const selectedStudy = localStorage.getItem('selectedStudy');

    const newDataset = {
      study: selectedStudy,
      name: formData.get('name'),
      labels: formData.getAll('labels'),
      description: formData.get('description'),
      resolution: formData.get('resolution'),
      base: formData.get('base') === 'on',
      randomTest: formData.get('randomTest'),
      for_testing: formData.get('forTesting') === 'on',
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
                    New Dataset
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
                  <form id="add-dataset-form" onSubmit={formHandler}>
                    <div className="space-y-5">
                      <div>
                        <label htmlFor="name" className={theme.classes.label}>Name</label>
                        <input id="name" name="name" type="text" required className={`mt-1.5 ${theme.classes.input}`} />
                      </div>

                      <div>
                        <label htmlFor="resolution" className={theme.classes.label}>Resolution</label>
                        <select id="resolution" name="resolution" required className={`mt-1.5 ${theme.classes.select}`}>
                          <option disabled>Select resolution...</option>
                          {resolutions.map((resolution) => (
                            <option key={resolution.res} value={resolution.res}>{resolution.des}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="labels" className={theme.classes.label}>Labels</label>
                        <select id="labels" name="labels" multiple required className={`mt-1.5 ${theme.classes.select}`} size={4}>
                          {labels.map((label) => (
                            <option key={label.id} value={label.id}>{label.name}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">Hold Ctrl/Cmd to select multiple labels.</p>
                      </div>

                      <div className="flex items-center gap-x-3">
                        <input
                          id="base"
                          name="base"
                          type="checkbox"
                          checked={base}
                          disabled={!base}
                          onChange={() => setBase(!base)}
                          className={theme.classes.checkbox}
                        />
                        <label htmlFor="base" className="text-sm font-medium text-gray-900">Base Dataset</label>
                      </div>

                      <div>
                        <label htmlFor="description" className={theme.classes.label}>Description</label>
                        <textarea id="description" name="description" rows={3} className={`mt-1.5 ${theme.classes.textarea}`} />
                      </div>
                    </div>
                  </form>
                </div>

                {/* Footer */}
                <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                  <button type="button" onClick={handleClose} className={theme.classes.btnSecondary}>
                    Cancel
                  </button>
                  <button type="submit" form="add-dataset-form" className={theme.classes.btnPrimary}>
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
