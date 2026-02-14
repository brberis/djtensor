/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: Tooltip.js
 * Copyright (c) 2024
 */

import { InformationCircleIcon } from '@heroicons/react/20/solid';

export default function Tooltip({ text }) {
  return (
    <div className="relative group inline-block ml-1.5">
      <InformationCircleIcon className="w-4 h-4 text-teal-500 cursor-pointer" />
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg py-2 px-3 z-50 shadow-lg w-52 leading-relaxed">
        {text}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
          <div className="border-4 border-transparent border-t-gray-900"></div>
        </div>
      </div>
    </div>
  );
}
