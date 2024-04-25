import React, { createContext, useContext, useState } from 'react';
import { useEffect } from 'react';
import Head from 'next/head';
import "../styles.css";

// Create a context
const AppContext = createContext();

// Create a provider component
export const AppProvider = ({ children }) => {
    const [state, setState] = useState({
        // initial state values here
    });

    // update state
    const updateState = (newState) => {
        setState(prevState => ({ ...prevState, ...newState }));
    };

    // Values and functions provided by the context
    const value = {
        state,
        updateState
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
};

// Use this custom hook to use state and updater in any functional component
export const useAppContext = () => useContext(AppContext);

// Component that uses the context
export default function App({ Component, pageProps }) {
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    return (
        <AppProvider>
            <Head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="theme-color" content="#ffffff" />
                <link rel="manifest" href="/manifest.json" />
                <link rel="apple-touch-icon" sizes="180x180" href="/icons/Icon-180.png" />
                <link rel="icon" type="image/png" sizes="32x32" href="/icons/Icon-32.png" />
                <link rel="icon" type="image/png" sizes="16x16" href="/icons/Icon-16.png" />
                <link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#5bbad5" />
                <title>Fossil</title>
            </Head>
            <Component {...pageProps} />
        </AppProvider>
    );
}
