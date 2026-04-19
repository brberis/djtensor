/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: shareDatasetDialog.js
 * Copyright (c) 2024
 */

import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, ExclamationCircleIcon, ShareIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';

export default function ShareDatasetDialog({ isOpen, onClose, dataset }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [studies, setStudies] = useState([]);
  const [ownerStudyId, setOwnerStudyId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    if (!isOpen || !dataset?.id) return;
    let cancelled = false;
    setAlert(null);
    setIsLoading(true);
    fetch(`/api/datasets/dataset/${dataset.id}/share`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Failed to load sharing');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setStudies(data.studies || []);
        setOwnerStudyId(data.owner_study ?? null);
        setSelected(new Set((data.shared || []).map(Number)));
      })
      .catch((err) => {
        if (!cancelled) setAlert(err.message || 'Failed to load sharing');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, dataset?.id]);

  const toggle = (id) => {
    if (id === ownerStudyId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setAlert(null);
    try {
      const res = await fetch(`/api/datasets/dataset/${dataset.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ study_ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to save');
      onClose(true);
    } catch (err) {
      setAlert(err.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const sharable = studies.filter((s) => s.id !== ownerStudyId);

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !isSaving && onClose(false)}>
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
                    onClick={() => !isSaving && onClose(false)}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 sm:mx-0">
                    <ShareIcon className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left flex-1">
                    <Dialog.Title as="h3" className="text-base font-semibold text-gray-900">
                      Share dataset with studies
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      {dataset?.name
                        ? <>Share <span className="font-medium text-gray-700">{dataset.name}</span> with other studies. Images are not copied — only references.</>
                        : 'Select studies that should see this dataset.'}
                    </p>
                  </div>
                </div>

                {alert && (
                  <div className="mt-3 rounded-md bg-red-50 p-3">
                    <div className="flex">
                      <ExclamationCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                      <p className="ml-3 text-sm text-red-700">{alert}</p>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  {isLoading ? (
                    <div className="py-6"><Spinner timeOut={0} /></div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-md ring-1 ring-inset ring-gray-300">
                      {sharable.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-gray-500">No other studies available to share with.</p>
                      ) : (
                        sharable.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(s.id)}
                              onChange={() => toggle(s.id)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{s.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                  {ownerStudyId && (
                    <p className="mt-2 text-xs text-gray-400">Owner study is always included.</p>
                  )}
                </div>

                <div className="mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => onClose(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSaving || isLoading}
                    onClick={handleSave}
                    className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
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
