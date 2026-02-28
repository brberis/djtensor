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

import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition, Listbox } from '@headlessui/react';
import {
  Bars3Icon,
  XMarkIcon,
  BeakerIcon,
  CircleStackIcon,
  CpuChipIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  ChevronUpDownIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/20/solid';
import Link from 'next/link';
import { useRouter } from 'next/router';
import theme from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Sidebar navigation items
const navigation = [
  { name: 'Training', href: '/', icon: CpuChipIcon },
  { name: 'Testing', href: '/testing', icon: ClipboardDocumentCheckIcon },
  { name: 'Performance', href: '/performance', icon: ChartBarIcon },
  { name: 'Datasets', href: '/datasets', icon: CircleStackIcon },
];

function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

const Layout = (props) => {
  const router = useRouter();
  const { children, action, incomingAction } = props;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studies, setStudies] = useState([]);
  const [selectedStudy, setSelectedStudy] = useState('');
  const { user, loading, logout } = useAuth();
  const { canMutate } = usePermissions();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/feature_extractor/studies/')
      .then((response) => response.json())
      .then((data) => {
        const sorted = [...data].reverse();
        setStudies(sorted);
        const storageKey = `selectedStudy_${user.id}`;
        const savedStudy = localStorage.getItem(storageKey) || localStorage.getItem('selectedStudy');
        if (savedStudy && sorted.some(s => String(s.id) === String(savedStudy))) {
          setSelectedStudy(savedStudy);
        } else if (sorted.length > 0) {
          const latestStudy = sorted[0].id;
          setSelectedStudy(latestStudy);
          localStorage.setItem(storageKey, latestStudy);
          localStorage.setItem('selectedStudy', latestStudy);
        }
      })
      .catch((error) => console.error('Error fetching studies:', error));
  }, [user]);

  const handleStudySelect = (studyId) => {
    const nextStudyId = String(studyId);
    setSelectedStudy(nextStudyId);
    localStorage.setItem(`selectedStudy_${user.id}`, nextStudyId);
    localStorage.setItem('selectedStudy', nextStudyId);
    // Keep body + dropdown perfectly in sync by reloading context
    window.location.assign('/');
  };

  const handleStudyChange = (e) => {
    handleStudySelect(e.target.value);
  };

  const isCurrentPath = (href) => {
    if (href === '/') {
      return router.pathname === '/' || router.pathname.startsWith('/training');
    }
    return router.pathname.startsWith(href);
  };

  const actionHandler = () => {
    if (incomingAction && action) {
      incomingAction(action);
    }
  };

  // Show spinner while checking auth
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  // Sidebar content reused for both mobile and desktop
  const sidebarContent = (
    <nav className="flex flex-1 flex-col">
      <ul role="list" className="flex flex-1 flex-col gap-y-7">
        <li>
          <div className="flex h-16 shrink-0 items-center px-2">
            <BeakerIcon className="h-8 w-8 text-blue-500" />
            <span className="ml-3 text-lg font-bold text-white tracking-tight">Shark AI</span>
          </div>
        </li>
        <li>
          <ul role="list" className="-mx-2 space-y-1">
            {navigation.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={classNames(
                    isCurrentPath(item.href)
                      ? 'bg-blue-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                    'group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold'
                  )}
                >
                  <item.icon
                    className={classNames(
                      isCurrentPath(item.href) ? 'text-white' : 'text-gray-400 group-hover:text-white',
                      'h-6 w-6 shrink-0'
                    )}
                    aria-hidden="true"
                  />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </li>

        {/* Study selector */}
        <li>
          <div className="px-2">
            <Listbox value={selectedStudy} onChange={handleStudySelect}>
              <div className="relative">
                <Listbox.Label className="block text-xs font-medium text-gray-400 mb-1">
                  Active Study
                  {(() => {
                    const st = studies.find(st => String(st.id) === String(selectedStudy));
                    return st && st.mode === 'review' ? (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Review</span>
                    ) : null;
                  })()}
                </Listbox.Label>
                <Listbox.Button className="relative w-full cursor-pointer rounded-md bg-gray-700 py-2 pl-3 pr-10 text-left text-sm text-white ring-1 ring-inset ring-gray-600 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors">
                  <span className="block truncate">
                    {studies.find(s => String(s.id) === String(selectedStudy))?.name || 'Select Study'}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                  </span>
                </Listbox.Button>
                <Transition
                  as={Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <Listbox.Options className="absolute z-50 mt-1 max-h-72 w-72 overflow-auto rounded-lg bg-gray-800 py-1 text-sm shadow-xl ring-1 ring-black/20 focus:outline-none">
                    {studies.map((study) => (
                      <Listbox.Option
                        key={study.id}
                        value={study.id}
                        className={({ active }) =>
                          `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${
                            active ? 'bg-blue-600 text-white' : 'text-gray-200'
                          }`
                        }
                      >
                        {({ selected, active }) => (
                          <>
                            <div className="flex flex-col">
                              <span className={`block truncate font-medium ${selected ? 'text-white' : ''}`}>
                                {study.name}
                              </span>
                              <span className={`block text-xs mt-0.5 ${active ? 'text-blue-200' : 'text-gray-500'}`}>
                                {formatDate(study.created_at)}
                              </span>
                              {study.description && (
                                <span className={`block text-xs mt-0.5 truncate ${active ? 'text-blue-100' : 'text-gray-400'}`}>
                                  {study.description}
                                </span>
                              )}
                            </div>
                            {selected && (
                              <span className={`absolute inset-y-0 left-0 flex items-center pl-3 ${active ? 'text-white' : 'text-blue-400'}`}>
                                <CheckIcon className="h-4 w-4" aria-hidden="true" />
                              </span>
                            )}
                          </>
                        )}
                      </Listbox.Option>
                    ))}
                  </Listbox.Options>
                </Transition>
              </div>
            </Listbox>
          </div>
        </li>

        {/* User section at the bottom */}
        <li className="mt-auto pb-4">
          <div className="border-t border-gray-700 pt-4 px-2">
            <div className="flex items-center gap-x-3 mb-3">
              <UserCircleIcon className="h-8 w-8 text-gray-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.username}</p>
                {user.email && (
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                )}
              </div>
            </div>
            <div className="flex gap-x-2">
              <Link
                href="/settings"
                className="flex-1 flex items-center justify-center gap-x-1.5 rounded-md bg-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              >
                <Cog6ToothIcon className="h-4 w-4" />
                Settings
              </Link>
              <button
                onClick={logout}
                className="flex-1 flex items-center justify-center gap-x-1.5 rounded-md bg-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </li>
      </ul>
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <Transition.Child
                  as={Fragment}
                  enter="ease-in-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in-out duration-300"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                    <button type="button" className="-m-2.5 p-2.5" onClick={() => setSidebarOpen(false)}>
                      <span className="sr-only">Close sidebar</span>
                      <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                    </button>
                  </div>
                </Transition.Child>
                <div className="flex grow flex-col gap-y-5 overflow-y-visible bg-gray-900 px-6 pb-4">
                  {sidebarContent}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Static sidebar for desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-visible bg-gray-900 px-6 pb-4">
          {sidebarContent}
        </div>
      </div>

      {/* Main content area */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
          <button
            type="button"
            className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Open sidebar</span>
            <Bars3Icon className="h-6 w-6" aria-hidden="true" />
          </button>

          {/* Separator for mobile */}
          <div className="h-6 w-px bg-gray-200 lg:hidden" aria-hidden="true" />

          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="flex flex-1 items-center">
              {/* Page context info can go here */}
            </div>
            <div className="flex items-center gap-x-4 lg:gap-x-6">
              {/* Study selector in top bar for quick access */}
              <div className="hidden sm:flex items-center gap-x-2">
                <Listbox value={selectedStudy} onChange={handleStudySelect}>
                  <div className="relative">
                    <Listbox.Label className="text-sm font-medium text-gray-500 mr-2">
                      Study:
                      {(() => {
                        const st = studies.find(st => String(st.id) === String(selectedStudy));
                        return st && st.mode === 'review' ? (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Review</span>
                        ) : null;
                      })()}
                    </Listbox.Label>
                    <Listbox.Button className="relative inline-flex items-center cursor-pointer rounded-md bg-white py-1.5 pl-3 pr-10 text-left text-sm text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-colors min-w-[180px]">
                      <span className="block truncate">
                        {studies.find(s => String(s.id) === String(selectedStudy))?.name || 'Select Study'}
                      </span>
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                      </span>
                    </Listbox.Button>
                    <Transition
                      as={Fragment}
                      leave="transition ease-in duration-100"
                      leaveFrom="opacity-100"
                      leaveTo="opacity-0"
                    >
                      <Listbox.Options className="absolute right-0 z-50 mt-1 max-h-72 w-80 overflow-auto rounded-lg bg-white py-1 text-sm shadow-xl ring-1 ring-black/10 focus:outline-none">
                        {studies.map((study) => (
                          <Listbox.Option
                            key={study.id}
                            value={study.id}
                            className={({ active }) =>
                              `relative cursor-pointer select-none py-2.5 pl-10 pr-4 ${
                                active ? 'bg-blue-50 text-blue-900' : 'text-gray-900'
                              }`
                            }
                          >
                            {({ selected, active }) => (
                              <>
                                <div className="flex flex-col">
                                  <span className={`block truncate ${selected ? 'font-semibold' : 'font-medium'}`}>
                                    {study.name}
                                  </span>
                                  <span className={`block text-xs mt-0.5 ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                                    {formatDate(study.created_at)}
                                  </span>
                                  {study.description && (
                                    <span className={`block text-xs mt-0.5 truncate ${active ? 'text-blue-500' : 'text-gray-400'}`}>
                                      {study.description}
                                    </span>
                                  )}
                                </div>
                                {selected && (
                                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                                    <CheckIcon className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                )}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </Transition>
                  </div>
                </Listbox>
              </div>
              {action && (() => {
                const currentStudyObj = studies.find(st => String(st.id) === String(selectedStudy));
                const studyMode = currentStudyObj?.mode || 'experiment';
                return canMutate(selectedStudy, studyMode) ? (
                  <button
                    type="button"
                    onClick={actionHandler}
                    className={theme.classes.btnPrimary}
                  >
                    {action}
                  </button>
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="py-6">
          <div className="px-4 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
