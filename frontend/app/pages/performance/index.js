/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: index.js
 * Copyright (c) 2024
 */

import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';
import { ChartBarIcon } from '@heroicons/react/24/outline';

export default function Performance() {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/feature_extractor/trainingsession/?status=Completed`);
        const data = await response.json();
        setSessions(data);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSessions();
  }, []);

  const renderCharts = (epochs, sessionId) => {
    const lossData = {
      values: [
        epochs.map(epoch => ({ x: epoch.number, y: epoch.loss })),
        epochs.map(epoch => ({ x: epoch.number, y: epoch.val_loss }))
      ],
      series: ['Training Loss', 'Validation Loss']
    };

    const accuracyData = {
      values: [
        epochs.map(epoch => ({ x: epoch.number, y: epoch.accuracy })),
        epochs.map(epoch => ({ x: epoch.number, y: epoch.val_accuracy }))
      ],
      series: ['Training Accuracy', 'Validation Accuracy']
    };

    const lossEl = document.getElementById(`loss-container-${sessionId}`);
    const accEl = document.getElementById(`accuracy-container-${sessionId}`);
    const lossWidth = lossEl ? Math.min(lossEl.clientWidth, 500) : 400;
    const accWidth = accEl ? Math.min(accEl.clientWidth, 500) : 400;

    tfvis.render.linechart(
      lossEl,
      lossData,
      { xLabel: 'Epoch', yLabel: 'Loss', width: lossWidth, height: 300 }
    );

    tfvis.render.linechart(
      accEl,
      accuracyData,
      { xLabel: 'Epoch', yLabel: 'Accuracy', width: accWidth, height: 300 }
    );
  };

  useEffect(() => {
    sessions.forEach(session => {
      if (session.epochs.length > 0 && document.getElementById(`loss-container-${session.id}`) && document.getElementById(`accuracy-container-${session.id}`)) {
        renderCharts(session.epochs, session.id);
      }
    });
  }, [sessions]);

  if (isLoading) {
    return (
      <Layout>
        <Spinner />
      </Layout>
    );
  }

  if (!sessions.length) {
    return (
      <Layout>
        <div className="text-center py-12">
          <ChartBarIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No completed sessions</h3>
          <p className="mt-1 text-sm text-gray-500">Performance data will appear once training sessions complete.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Performance Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Compare training metrics across all completed sessions.
        </p>
      </div>

      <div className="space-y-8">
        {sessions.map(session => (
          <div key={session.id} className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
            {/* Session header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{session.name}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {session.notes || 'No notes'}
              </p>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Session info */}
              <div>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Training Date</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {new Date(session.created_at).toLocaleDateString("en-US", {
                        year: 'numeric', month: 'short', day: 'numeric'
                      })}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Model</dt>
                    <dd className="text-sm font-medium text-gray-900">{session.model?.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Dataset</dt>
                    <dd className="text-sm font-medium text-gray-900">{session.dataset?.name}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Resolution</dt>
                    <dd className="text-sm font-medium text-gray-900">{session.dataset?.resolution}px</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Status</dt>
                    <dd>
                      <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                        {session.status}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Charts */}
              {session.epochs.length > 0 && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Loss</h4>
                    <div id={`loss-container-${session.id}`} className="overflow-x-auto" style={{ width: '100%', maxWidth: '100%' }}></div>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Accuracy</h4>
                    <div id={`accuracy-container-${session.id}`} className="overflow-x-auto" style={{ width: '100%', maxWidth: '100%' }}></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
