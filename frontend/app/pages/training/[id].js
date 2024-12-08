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
  }

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
        const duration = updatedAt - createdAt;
        const durationInSeconds = duration / 1000;
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
        epochs.map(epoch => ({ x: epoch.number, y: epoch.loss })), // Training loss
        epochs.map(epoch => ({ x: epoch.number, y: epoch.val_loss })) // Validation loss
      ],
      series: ['Training Loss', 'Validation Loss']
    };
  
    const accuracyData = {
      values: [
        epochs.map(epoch => ({ x: epoch.number, y: epoch.accuracy })), // Training accuracy
        epochs.map(epoch => ({ x: epoch.number, y: epoch.val_accuracy })) // Validation accuracy
      ],
      series: ['Training Accuracy', 'Validation Accuracy']
    };

    // Render loss chart
    tfvis.render.linechart(
      document.getElementById('loss-container'),
      lossData,
      { xLabel: 'Epoch', yLabel: 'Loss', width: 400, height: 300 }
    );

    // Render accuracy chart
    tfvis.render.linechart(
      document.getElementById('accuracy-container'),
      accuracyData,
      { xLabel: 'Epoch', yLabel: 'Accuracy', width: 400, height: 300 }
    );
  };

  if (isLoading) {
    return <Spinner />;
  }

  if (!session) {
    return <p>No session data found.</p>;
  }

  return (
    <Layout>
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Training Session Detail</h1>
            <p className="mt-2 text-sm text-gray-700">
              Detailed information about the training session including dataset and model used.
            </p>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Session: {session.name}</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Notes: {session.notes || "N/A"}</p>
            </div>
            <div className="border-t border-gray-200">
              <dl>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Training Date</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    {new Date(session.created_at).toLocaleDateString("en-US", {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true
                    })}
                  </dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Duration</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{duration}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.status}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Model</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.name}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Dataset</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    <Link href={`/datasets/${session.dataset.id}`} className="text-blue-500 hover:text-blue-800">
                      {session.dataset.name}
                    </Link>
                  </dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Resolution</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.resolution}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Epochs</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.epochs}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Validation Split</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.validation_split}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Batch Size</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.batch_size}</dd>
                </div>
              </dl>
            </div>
          </div>
          {epochs.length > 0 && (
            <div className="space-y-4">
              <div id="loss-container" style={{ width: '100%', height: '300px' }}></div>
              <div id="accuracy-container" style={{ width: '100%', height: '300px' }}></div>
            </div>
          )}
        </div>
        <div className="mt-8">
          <h2 className="text-lg leading-6 font-medium text-gray-900">Training Epochs</h2>
          <div className="mt-4">
            {epochs.length ? (
              epochs.map(epoch => (
                <div key={epoch.id} className="bg-white shadow overflow-hidden sm:rounded-lg p-4 mb-4">
                  <p><strong>Epoch Number:</strong> {epoch.number}</p>
                  <p><strong>Accuracy:</strong> {epoch.accuracy}</p>
                  <p><strong>Loss:</strong> {epoch.loss}</p>
                  <p><strong>Validation Accuracy:</strong> {epoch.val_accuracy}</p>
                  <p><strong>Validation Loss:</strong> {epoch.val_loss}</p>
                </div>
              ))
            ) : (
              <p>No epochs data available.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
  
}
