/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: Navbar.js
 * Copyright (c) 2024
 */

import { Fragment, useEffect, useState } from 'react';
import Link from "next/link";
import { useRouter } from 'next/router';
import { Disclosure } from '@headlessui/react';

const navigation = [
  { name: 'Training', href: '/' },
  { name: 'Testing', href: '/testing' },
  { name: 'Performance', href: '/performance' },
  { name: 'Datasets', href: '/datasets' }
];

function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}

function Navbar() {
  const router = useRouter();
  const [studies, setStudies] = useState([]);
  const [selectedStudy, setSelectedStudy] = useState('');

  useEffect(() => {
    // Fetch the list of studies from the API
    fetch('/api/feature_extractor/studies/')
      .then((response) => response.json())
      .then((data) => {
        setStudies(data);
        // Retrieve the selected study from local storage
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
  }, []);

  // Function to handle study selection
  const handleStudyChange = (e) => {
    const studyId = e.target.value;
    setSelectedStudy(studyId);
    localStorage.setItem('selectedStudy', studyId);
    const url = new URL(window.location);
    url.searchParams.set('studyId', studyId);
    //redirect to home page
    window.location.assign('/');
  };

  // Function to determine if the link is the current page
  const isActive = (href) => {
    return router.pathname === href;
  };

  return (
    <Disclosure as="nav" className="relative z-40 max-w-screen-xl ml-10 mb-10 mt-6 pt-6 overflow-hidden border-b-2 border-gray-300">
      <ul className="flex flex-wrap text-sm font-medium text-center text-gray-500 dark:text-gray-400">
        {navigation.map((item) => (
          <li key={item.name} className="mr-0 w-40">
            <Link 
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={classNames(
                isActive(item.href) ? 'bg-sky-300 text-black' : 'bg-sky-200 text-black hover:bg-blue-200',
                'px-8 py-2 border-2 border-sky-500 rounded-t-3xl text-lg font-medium flex items-center justify-center' 
              )}
            >
              {item.name}
            </Link>
          </li>
        ))}
        <div className="flex ml-auto mr-0 items-center w-100 space-x-2">
          <label htmlFor="study" className="block text-sm font-medium text-gray-700">
            Study:
          </label>
          <select
            value={selectedStudy}
            onChange={handleStudyChange}
            className="px-4 py-1 border border-gray-400 text-sm font-medium text-gray-700"
          >
            <option value="" disabled>Select Study</option>
            {studies.map((study) => (
              <option key={study.id} value={study.id}>
                {study.name}
              </option>
            ))}
          </select>
        </div>
      </ul>
    </Disclosure>
  );
}

export default Navbar;
