/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: Header.js
 * Copyright (c) 2024
 */

import { useState, useEffect } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid';
import Link from "next/link";
import { useRouter } from 'next/router';

export default function Header(props) {
  const { sectionTitle, action, actions, incomingAction, breadcrumbs, smallScreenHeader, isLocal } = props;
  const [ariaCurrent, setAriaCurrent] = useState(null);
  const [defaultBgColor, setDefaultBgColor] = useState('sky');
  const [sidebarWidth, setSidebarWidth] = useState(300); 
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const router = useRouter();

  const actionHandler = (e) => {
    incomingAction(e);
  };

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarWidth(80);
        setIsSmallScreen(true); 
      } else {
        setSidebarWidth(160);
        setIsSmallScreen(false); 
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize(); 

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    setIsActive(queryParams.get('active') == 1);
  }, [router]);

  return (
    <>
      <div className='md:m-4'>
        <div className='hidden sm:block'>
          <nav className="sm:hidden" aria-label="Back">
            <Link href="#" className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-700">
              <ChevronLeftIcon className="-ml-1 mr-1 h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" />
              Back
            </Link>
          </nav>
          {(breadcrumbs && !isLocal) &&
            <nav className="hidden sm:flex" aria-label="Breadcrumb">
              <ol role="list" className="flex items-center space-x-4">
                {breadcrumbs.map((bc) => (
                  <li key={bc.title}>
                    <>
                      <div className={`flex items-center ${breadcrumbs.indexOf(bc) > 0 ? 'items-center' : ''}`}>
                        {breadcrumbs.indexOf(bc) > 0 ? <ChevronRightIcon className="h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" /> : null}
                        <Link href={bc.href} aria-current={ariaCurrent} className={'text-sm font-medium text-gray-500 hover:text-gray-700'}>
                          {bc.title}
                        </Link>
                      </div>
                    </>
                  </li>
                ))}
              </ol>
            </nav>
          }
        </div>
        <div className="flex items-center justify-between border-b border-gray-200 py-4 px-4 lg:flex-none">
          <div className="min-w-0 flex-1">
            <h2 className="md:ml-0 text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              {sectionTitle}
            </h2>
          </div>
          {action &&
            <div className="mt-4 flex flex-shrink-0 md:mt-0 md:ml-4 sm:-mr-8">
              <button
                type="button"
                onClick={() => actionHandler(action)}
                className={`ml-3 inline-flex items-center rounded-md border border-transparent bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={!isActive}
              >
                {action}
              </button>
            </div>
          }
          {actions ?
            <div className="mt-4 flex flex-shrink-0 md:mt-0 md:ml-4 sm:-mr-8">
              {actions.map((action, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => actionHandler(action.title)}
                  className={`ml-3 inline-flex items-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white shadow-sm bg-${action.bgColor ? action.bgColor : defaultBgColor}-600 hover:bg-${action.bgColor ? action.bgColor : defaultBgColor}-700 focus:outline-none focus:ring-2 focus:ring-${action.bgColor ? action.bgColor : defaultBgColor}-500 focus:ring-offset-2 ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!isActive}
                >
                  {action.title}
                </button>
              ))}
            </div>
            : null}
        </div>
      </div>
    </>
  )
}
