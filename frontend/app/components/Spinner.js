import React, { useEffect, useState } from "react";

export default function Spinner({timeOut}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (timeOut) {
      timeOut = 1;
    }
    const timer = setTimeout(() => {
      setShow(true);
    }, timeOut || 0); // Show spinner after 1 seconds

    return () => clearTimeout(timer); // Clear timeout if the component is unmounted
  }, []);

  return show ? (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
    </div>
  ) : null;
}

 


export function TablePlaceholder() {
  return (
    <table className="min-w-full bg-white">
      <thead>
        <tr>
          {[...Array(5)].map((_, index) => (
            <th key={index} className="py-2 px-6 bg-gray-200 text-left text-xs leading-4 font-medium text-gray-500 uppercase tracking-wider">
              <div className="bg-gray-300 w-24 h-4 animate-pulse rounded"></div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...Array(8)].map((_, rowIndex) => (
          <tr key={rowIndex}>
            {[...Array(5)].map((_, cellIndex) => (
              <td key={cellIndex} className="px-6 py-4 whitespace-no-wrap text-sm leading-5 font-medium">
                <div className="bg-gray-300 w-full h-4 animate-pulse rounded"></div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CalendarPlaceholder() {
  return (
    <div className="bg-gray-100 p-4 rounded">
      <div className="flex justify-between">
        <div className="bg-gray-300 w-1/4 h-6 rounded"></div>
        <div className="bg-gray-300 w-1/4 h-6 rounded"></div>
      </div>
      <div className="grid grid-cols-7 gap-4 mt-4">
        {[...Array(7)].map((_, index) => (
          <div key={index} className="bg-gray-300 w-full h-12 rounded"></div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-4 mt-2">
        {[...Array(42)].map((_, index) => (
          <div key={index} className="bg-gray-300 w-full h-12 rounded animate-pulse"></div>
        ))}
      </div>
    </div>
  );
}



