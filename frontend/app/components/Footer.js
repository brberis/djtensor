/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: Footer.js
 * Copyright (c) 2024
 */


  export default function Footer() {

    return (
      <footer className="bg-sky-800 pb-10 mt-60" aria-labelledby="footer-heading">

        <div className="mx-auto max-w-7xl py-12 px-4 sm:px-6 lg:py-16 lg:px-8">

          <div className="mt-16 border-t border-gray-700 pt-8 md:flex md:items-center md:justify-between">

            <p className="mt-8 text-base text-gray-400 md:order-1 md:mt-0">
              &copy; 2024 Fossil
            </p>
          </div>
        </div>
      </footer>
    )
  }