/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: [id].js
 * Copyright (c) 2024
 */

import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';
import Link from 'next/link';
import { getStatusBadgeClass } from '../../theme';

export default function TrainingDetail() {
  const [session, setSession] = useState(null);
  const [epochs, setEpochs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { id } = router.query;
  const [duration, setDuration] = useState(0);

  const formatDuration = (durationInSeconds) => {
    const seconds = Math.floor(durationInSeconds % 60);
    const minutes = Math.floor((durationInSeconds / 60) % 60);
    const hours = Math.floor(durationInSeconds / 3600);

    const paddedHours = hours.toString().padStart(2, '0');
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
  };

  useEffect(() => {
    const fetchSession = async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        const sessionResponse = await fetch(`/api/feature_extractor/trainingsession/${id}`);
        const sessionData = await sessionResponse.json();
        setSession(sessionData);
        const createdAt = new Date(sessionData.created_at);
        const updatedAt = new Date(sessionData.updated_at);
        const dur = updatedAt - createdAt;
        const durationInSeconds = dur / 1000;
        setDuration(formatDuration(durationInSeconds));

        const epochsResponse = await fetch(`/api/feature_extractor/epoch/?training_session=${id}`);
        const epochsData = await epochsResponse.json();
        setEpochs(epochsData);
      } catch (error) {
        console.error('Failed to fetch session or epochs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  useEffect(() => {
    if (epochs.length > 0 && document.getElementById('loss-container') && document.getElementById('accuracy-container')) {
      renderCharts();
    }
  }, [epochs]);

  const renderCharts = () => {
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

    const lossEl = document.getElementById('loss-container');
    const accEl = document.getElementById('accuracy-container');
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

  if (isLoading) {
    return (
      <Layout>
        <Spinner />
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <p className="text-gray-500 text-center py-8">No session data found.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="mb-6">
        <div className="flex items-center gap-x-3">
          <button onClick={() => router.push('/training')} className="text-sm text-gray-500 hover:text-gray-700">
            Training Sessions
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-900">{session.name}</span>
        </div>
        <div className="mt-3 flex items-center gap-x-3">
          <h1 className="text-2xl font-bold text-gray-900">{session.name}</h1>
          <span className={getStatusBadgeClass(session.status)}>{session.status}</span>
        </div>
        {session.notes && (
          <p className="mt-1 text-sm text-gray-500">{session.notes}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Session details card */}
        <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Session Details</h3>
          </div>
          <dl className="divide-y divide-gray-100">
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Training Date</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                {new Date(session.created_at).toLocaleDateString("en-US", {
                  year: 'numeric', month: 'long', day: 'numeric',
                  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                })}
              </dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Duration</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 font-mono">{duration}</dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Model</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.name}</dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Dataset</dt>
              <dd className="mt-1 text-sm sm:mt-0 sm:col-span-2">
                <Link href={`/datasets/${session.dataset.id}`} className="text-teal-600 hover:text-teal-500 font-medium">
                  {session.dataset.name}
                </Link>
              </dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Resolution</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.resolution}px</dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Epochs</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.epochs}</dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Validation Split</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.validation_split}</dd>
            </div>
            <div className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Batch Size</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.batch_size}</dd>
            </div>
          </dl>
        </div>

        {/* Charts */}
        {epochs.length > 0 && (
          <div className="space-y-6">
            <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Loss Over Epochs</h3>
              <div id="loss-container" style={{ width: '100%', height: '300px' }}></div>
            </div>
            <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Accuracy Over Epochs</h3>
              <div id="accuracy-container" style={{ width: '100%', height: '300px' }}></div>
            </div>
          </div>
        )}
      </div>

      {/* Epoch details */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Epoch Details</h2>
        {epochs.length ? (
          <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Epoch</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Accuracy</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Loss</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Val Accuracy</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Val Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {epochs.map(epoch => (
                  <tr key={epoch.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{epoch.number}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{Number(epoch.accuracy).toFixed(4)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{Number(epoch.loss).toFixed(4)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{Number(epoch.val_accuracy).toFixed(4)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{Number(epoch.val_loss).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No epoch data available.</p>
        )}
      </div>
    </Layout>
  );
}
