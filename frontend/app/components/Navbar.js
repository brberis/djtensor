import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/router';
import { Disclosure, Menu, Transition } from '@headlessui/react'
import { Bars3Icon, BellIcon, XMarkIcon } from '@heroicons/react/24/outline'
import Link from "next/link";
import { UserIcon } from '@heroicons/react/20/solid'
import Router from 'next/router';
import Image from 'next/image';
// import avatar from '/public/avatar.jpg'
import Spinner from "../components/Spinner";

const navigation = [
  { name: 'Training', href: '/', current: false },
  { name: 'Test', href: '/test', current: false },
  { name: 'Performace', href: '/performance', current: false },
  { name: 'Datasets', href: '/datasets', current: false }
]

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

function Navbar() {


  return (
    <Disclosure as="nav" className={`relative bg-gray-700 z-40 mb-10` } >
      {({ open }) => (
        <>
          <div className={`mx-auto max-w-7xl px-2 sm:px-6 lg:px-8`}>
            <div className="relative flex h-16 items-center justify-between">
              <div className="absolute inset-y-0 left-0 flex items-center sm:hidden">
                {/* Mobile menu button*/}
                <Disclosure.Button className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white">
                  <span className="sr-only">Open main menu</span>
                  {open ? (
                    <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                  ) : (
                    <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                  )}
                </Disclosure.Button>
              </div>
              <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
                <div className="flex flex-shrink-0 items-center">
                  <Link href={'/'}>

                  </Link>
                </div>
                <div className="hidden sm:ml-6 sm:block mt-6 pb-4 pl-10">
                  <div className="flex space-x-4">
                      {navigation.map((item) => (
                        <Link href={item.href}
                            key={item.name}
                            className={classNames(
                              item.current ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                              'px-3 py-2 rounded-md text-sm font-medium'
                            )}
                            aria-current={item.current ? 'page' : undefined}
                          >
                            {item.name}
                        </Link>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Disclosure>
  )
}



export default Navbar;



