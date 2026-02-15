/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: LogViewer.js
 * Copyright (c) 2024
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export default function LogViewer({ sessionId, onClose }) {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const terminalRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;

    // Clear previous state
    setLines([]);
    setError(null);
    setConnected(false);

    const url = `/api/feature_extractor/trainingsession/${sessionId}/logs/`;
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      const data = event.data;
      setLines((prev) => {
        // Keep a rolling buffer of 2000 lines to prevent memory issues
        const next = [...prev, data];
        return next.length > 2000 ? next.slice(-1500) : next;
      });
    };

    eventSource.onerror = () => {
      // SSE auto-reconnects on error; if the stream ends normally
      // the readyState will be CLOSED
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnected(false);
      } else {
        setError('Connection lost. Reconnecting...');
        setTimeout(() => setError(null), 3000);
      }
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sessionId]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const handleClose = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    onClose();
  };

  return (
    <Transition.Root show={!!sessionId} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-gray-950 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-red-500" />
                      <span className="h-3 w-3 rounded-full bg-yellow-500" />
                      <span className="h-3 w-3 rounded-full bg-green-500" />
                    </div>
                    <Dialog.Title as="h3" className="text-sm font-medium text-gray-300">
                      Training Logs
                    </Dialog.Title>
                    {connected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        Live
                      </span>
                    )}
                    {error && (
                      <span className="text-xs text-yellow-400">{error}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rounded-md text-gray-500 hover:text-gray-300 focus:outline-none"
                    onClick={handleClose}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Terminal body */}
                <div
                  ref={terminalRef}
                  className="h-[28rem] sm:h-[32rem] overflow-y-auto overflow-x-auto px-4 py-3 font-mono text-xs sm:text-sm leading-relaxed text-green-400 selection:bg-green-800 selection:text-green-200"
                >
                  {lines.length === 0 && !error ? (
                    <div className="text-gray-500 animate-pulse">
                      Waiting for log output...
                    </div>
                  ) : (
                    lines.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">
                        {colorize(line)}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-800 px-4 py-2">
                  <span className="text-xs text-gray-600">
                    {lines.length} lines
                  </span>
                  <button
                    type="button"
                    className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                    onClick={handleClose}
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

// Simple colorizer for terminal-like output
function colorize(line) {
  if (!line) return line;

  // Error lines in red
  if (/error|ERROR|Error|exception|Exception|Traceback|failed|FAILED/i.test(line)) {
    return <span className="text-red-400">{line}</span>;
  }
  // Warning lines in yellow
  if (/warning|WARNING|Warning|WARN/i.test(line)) {
    return <span className="text-yellow-400">{line}</span>;
  }
  // Info/success in green
  if (/succeeded|SUCCESS|Completed|accuracy|val_accuracy/i.test(line)) {
    return <span className="text-green-300">{line}</span>;
  }
  // Epoch progress
  if (/Epoch\s+\d+/i.test(line)) {
    return <span className="text-cyan-400">{line}</span>;
  }

  return line;
}
