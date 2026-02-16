/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: ConfirmDialog.js
 * Copyright (c) 2024
 *
 * Reusable confirmation dialog. Supports an optional type-to-confirm
 * pattern: pass requireText with the exact string the user must type
 * before the confirm button enables.
 */

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmTone = 'primary',
  requireText,
  requireTextLabel,
  onConfirm,
  onClose,
}) {
  const [typed, setTyped] = useState('');

  // Reset typed text whenever dialog opens or requireText changes
  useEffect(() => {
    if (open) setTyped('');
  }, [open, requireText]);

  const needsTyping = Boolean(requireText);
  const typingMatch = !needsTyping || typed === requireText;

  const confirmClasses =
    confirmTone === 'danger'
      ? 'bg-red-600 hover:bg-red-500 focus-visible:outline-red-600 disabled:bg-red-300 disabled:cursor-not-allowed'
      : 'bg-teal-600 hover:bg-teal-500 focus-visible:outline-teal-600 disabled:bg-teal-300 disabled:cursor-not-allowed';

  return (
    <Transition.Root show={Boolean(open)} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
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
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:w-full sm:max-w-lg sm:p-6">
                <Dialog.Title as="h3" className="text-base font-semibold text-gray-900">
                  {title}
                </Dialog.Title>
                {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}

                {needsTyping && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700">
                      {requireTextLabel || <>Type <span className="font-semibold text-gray-900">{requireText}</span> to confirm</>}
                    </label>
                    <input
                      type="text"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      className="mt-1.5 block w-full rounded-md border-0 py-1.5 px-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-teal-600 sm:text-sm"
                      placeholder={requireText}
                      autoFocus
                    />
                  </div>
                )}

                <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
                  <button
                    type="button"
                    disabled={!typingMatch}
                    className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto ${confirmClasses}`}
                    onClick={onConfirm}
                  >
                    {confirmLabel}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={onClose}
                  >
                    Cancel
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
