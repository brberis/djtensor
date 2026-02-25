/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: Spinner.js
 * Copyright (c) 2024
 */

import React, { useEffect, useState } from "react";

export default function Spinner({ timeOut }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const delay = timeOut ? 1 : 0;
    const timer = setTimeout(() => {
      setShow(true);
    }, delay);

    return () => clearTimeout(timer);
  }, []);

  return show ? (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-gray-200 border-t-blue-600"></div>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  ) : null;
}

export function TableSpinnerRow({ colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10">
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-[3px] border-gray-200 border-t-blue-600" />
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function TablePlaceholder() {
  return (
    <div className="bg-white rounded-lg shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
      <table className="min-w-full">
        <thead>
          <tr className="bg-gray-50">
            {[...Array(5)].map((_, index) => (
              <th key={index} className="px-6 py-3">
                <div className="bg-gray-200 w-24 h-4 animate-pulse rounded"></div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {[...Array(6)].map((_, rowIndex) => (
            <tr key={rowIndex}>
              {[...Array(5)].map((_, cellIndex) => (
                <td key={cellIndex} className="px-6 py-4">
                  <div className="bg-gray-100 w-full h-4 animate-pulse rounded"></div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
