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

  // Function to determine if the link is the current page
  const isActive = (href) => {
    return router.pathname === href;
  };

  return (
    <Disclosure as="nav" className="relative z-40 ml-10 mb-10 mt-6 pt-6 overflow-hidden border-b-2 border-gray-300">
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
      </ul>
    </Disclosure>
  );
}

export default Navbar;
