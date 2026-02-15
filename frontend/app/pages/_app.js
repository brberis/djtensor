/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: _app.js
 * Copyright (c) 2024
 */

import React, { createContext, useContext, useState } from 'react';
import Head from 'next/head';
import "../styles/globals.css";
import { AuthProvider } from '../contexts/AuthContext';

// App-wide state context
const AppContext = createContext();

export const AppProvider = ({ children }) => {
    const [state, setState] = useState({});

    const updateState = (newState) => {
        setState(prevState => ({ ...prevState, ...newState }));
    };

    return (
        <AppContext.Provider value={{ state, updateState }}>
            {children}
        </AppContext.Provider>
    );
};

export const useAppContext = () => useContext(AppContext);

export default function App({ Component, pageProps }) {
    return (
        <AuthProvider>
            <AppProvider>
                <Head>
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <meta name="theme-color" content="#ffffff" />
                    <link rel="apple-touch-icon" sizes="180x180" href="/icons/Icon-180.png" />
                    <link rel="icon" type="image/png" sizes="32x32" href="/icons/Icon-32.png" />
                    <link rel="icon" type="image/png" sizes="16x16" href="/icons/Icon-16.png" />
                    <link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#5bbad5" />
                    <title>Shark AI</title>
                </Head>
                <Component {...pageProps} />
            </AppProvider>
        </AuthProvider>
    );
}
