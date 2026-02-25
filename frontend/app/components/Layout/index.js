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
import { Dialog, Transition } from '@headlessui/react';
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
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/router';
import theme from '../../theme';
import { useAuth } from '../../contexts/AuthContext';

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
        setStudies(data);
        const savedStudy = localStorage.getItem('selectedStudy');
        if (savedStudy) {
          setSelectedStudy(savedStudy);
        } else if (data.length > 0) {
          const lastStudy = data[data.length - 1].id;
          setSelectedStudy(lastStudy);
          localStorage.setItem('selectedStudy', lastStudy);
        }
      })
      .catch((error) => console.error('Error fetching studies:', error));
  }, [user]);

  const handleStudyChange = (e) => {
    const studyId = e.target.value;
    setSelectedStudy(studyId);
    localStorage.setItem('selectedStudy', studyId);
    window.location.assign('/');
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
  const SidebarContent = () => (
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
            <label htmlFor="sidebar-study" className="block text-xs font-medium text-gray-400 mb-1">
              Active Study
            </label>
            <select
              id="sidebar-study"
              value={selectedStudy}
              onChange={handleStudyChange}
              className="block w-full rounded-md bg-gray-700 border-0 py-1.5 pl-3 pr-8 text-sm text-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Select Study</option>
              {studies.map((study) => (
                <option key={study.id} value={study.id}>
                  {study.name}
                </option>
              ))}
            </select>
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
                <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
                  <SidebarContent />
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Static sidebar for desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
          <SidebarContent />
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
                <label htmlFor="topbar-study" className="text-sm font-medium text-gray-500">
                  Study:
                </label>
                <select
                  id="topbar-study"
                  value={selectedStudy}
                  onChange={handleStudyChange}
                  className="rounded-md border-0 py-1 pl-3 pr-8 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600"
                >
                  <option value="" disabled>Select Study</option>
                  {studies.map((study) => (
                    <option key={study.id} value={study.id}>
                      {study.name}
                    </option>
                  ))}
                </select>
              </div>
              {action && (
                <button
                  type="button"
                  onClick={actionHandler}
                  className={theme.classes.btnPrimary}
                >
                  {action}
                </button>
              )}
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
