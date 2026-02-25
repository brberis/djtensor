/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: theme.js
 * Copyright (c) 2024
 */

// Centralized theme configuration for the Shark AI platform.
// Uses a science/research palette: modern blue as the primary accent,
// warm amber for warnings and secondary actions, slate for neutrals.

const theme = {
  colors: {
    // Primary - modern blue, suitable for a marine research platform
    primary: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
    },
    // Accent - warm amber for CTAs and highlights
    accent: {
      50: '#fffbeb',
      100: '#fef3c7',
      200: '#fde68a',
      300: '#fcd34d',
      400: '#fbbf24',
      500: '#f59e0b',
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f',
    },
  },

  // Tailwind class shortcuts for use in components
  classes: {
    // Buttons
    btnPrimary:
      'rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors',
    btnSecondary:
      'rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-colors',
    btnDanger:
      'rounded-md bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 transition-colors',
    btnDisabled:
      'rounded-md bg-gray-300 px-3.5 py-2 text-sm font-semibold text-gray-500 cursor-not-allowed',

    // Form inputs
    input:
      'block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6',
    select:
      'block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6',
    textarea:
      'block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6',
    label: 'block text-sm font-medium leading-6 text-gray-900',
    checkbox:
      'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600',

    // Cards and containers
    card: 'bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden',
    pageContainer: 'px-4 sm:px-6 lg:px-8 py-6',

    // Tables
    tableHeader: 'bg-gray-50',
    tableHeaderCell: 'px-3 py-3.5 text-left text-sm font-semibold text-gray-900',
    tableCell: 'whitespace-nowrap px-3 py-4 text-sm text-gray-500',
    tableRow: 'hover:bg-gray-50 transition-colors',
    tableRowClickable: 'cursor-pointer hover:bg-blue-50 transition-colors',

    // Status badges
    statusCompleted: 'inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20',
    statusPending: 'inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20',
    statusTraining: 'inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10',
    statusFailed: 'inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10',
  },
};

// Returns the correct status badge class for a given status string
export function getStatusBadgeClass(status) {
  switch (status) {
    case 'Completed':
      return theme.classes.statusCompleted;
    case 'Pending':
      return theme.classes.statusPending;
    case 'Training':
      return theme.classes.statusTraining;
    case 'Failed':
      return theme.classes.statusFailed;
    default:
      return 'inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10';
  }
}

export default theme;
