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
import { useEffect, useState, useCallback } from 'react';
import Layout from '../../components/Layout';
import BulkUploadDialog from '../../components/BulkUploadDialog';
import axios from 'axios';
import Spinner from '../../components/Spinner';
import theme from '../../theme';
import { ArrowUpTrayIcon, PhotoIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';

export default function DatasetDetail() {
  const [dataset, setDataset] = useState(null);
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState({});
  const [hasMore, setHasMore] = useState({});
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const router = useRouter();
  const { id } = router.query;

  const fetchAllData = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const [datasetData, labelsData] = await Promise.all([
        fetch(`/api/datasets/dataset/${id}`).then(res => res.json()),
        fetch(`/api/datasets/label/?datasets__id=${id}`).then(res => res.json())
      ]);

      setDataset(datasetData);
      setLabels(labelsData);

      const initialPages = {};
      const initialHasMore = {};
      const initialImages = {};
      labelsData.forEach(label => {
        initialPages[label.id] = 1;
        initialHasMore[label.id] = true;
      });
      setPage(initialPages);
      setHasMore(initialHasMore);
      setImages({});

      // Fetch first page of images for each label
      for (const label of labelsData) {
        fetchImages(label.id, 1);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const fetchImages = useCallback(async (labelId, page) => {
    try {
      const res = await fetch(`/api/datasets/image/?dataset=${id}&label=${labelId}&page=${page}`);
      const data = await res.json();
      setImages(prev => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...data.results]
      }));
      setHasMore(prev => ({
        ...prev,
        [labelId]: data.next !== null
      }));
    } catch (error) {
      console.error('Failed to fetch images:', error);
    }
  }, [id]);

  const handleUpload = async (files, labelId, datasetId) => {
    const formData = new FormData();
    formData.append('label', labelId);
    formData.append('dataset', datasetId);
    Array.from(files).forEach(file => {
      formData.append('file', file);
    });

    try {
      const response = await axios.post('/api/datasets/image/upload', formData);
      if (response.status !== 201) {
        throw new Error('Failed to upload images');
      }
      if (!Array.isArray(response.data.images)) {
        throw new Error("Invalid image data received");
      }
      setImages(prev => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...response.data.images]
      }));
    } catch (error) {
      console.error('Error uploading images:', error);
    }
  };

  const handleBulkUploadClose = () => {
    setShowBulkUpload(false);
    // Refresh data to show newly uploaded images
    fetchAllData();
  };

  if (isLoading) {
    return (
      <Layout>
        <Spinner />
      </Layout>
    );
  }

  if (!dataset || dataset.message) {
    return (
      <Layout>
        <div className="text-center py-12">
          <PhotoIcon className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No dataset found</h3>
          <p className="mt-1 text-sm text-gray-500">The requested dataset could not be loaded.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Bulk upload dialog */}
      {showBulkUpload && (
        <BulkUploadDialog
          isOpen={showBulkUpload}
          onClose={handleBulkUploadClose}
          datasetId={dataset.id}
          labels={labels}
        />
      )}

      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-x-3">
          <button
            onClick={() => router.push('/datasets')}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Datasets
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-900">{dataset.name}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{dataset.name}</h1>
            {dataset.description && (
              <p className="mt-1 text-sm text-gray-500">{dataset.description}</p>
            )}
          </div>
          <button
            onClick={() => setShowBulkUpload(true)}
            className={`${theme.classes.btnPrimary} flex items-center gap-2`}
          >
            <CloudArrowUpIcon className="h-5 w-5" />
            Bulk Upload
          </button>
        </div>
      </div>

      {/* Dataset info card */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl mb-6 p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-gray-500">Resolution</dt>
            <dd className="mt-1 text-sm text-gray-900">{dataset.resolution}px</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Type</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {dataset.base ? 'Base' : dataset.for_testing ? 'Testing' : 'Training'}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Labels</dt>
            <dd className="mt-1 text-sm text-gray-900">{labels.length} categories</dd>
          </div>
        </dl>
      </div>

      {/* Labels and images */}
      <div className="space-y-6">
        {labels.map(label => (
          <div key={label.id} className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{label.name}</h3>
                <p className="text-sm text-gray-500">{label.image_count} images</p>
              </div>
              <label className={`${theme.classes.btnSecondary} cursor-pointer flex items-center gap-1.5`}>
                <ArrowUpTrayIcon className="h-4 w-4" />
                Upload
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(e) => handleUpload(e.target.files, label.id, dataset.id)}
                />
              </label>
            </div>
            <div className="p-5">
              {(images[label.id] || []).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No images uploaded yet.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {(images[label.id] || []).map(image => (
                    <div key={image.id} className="relative group">
                      <img
                        src={image.image}
                        alt={label.name}
                        className="h-24 w-24 object-cover rounded-lg ring-1 ring-gray-200"
                        loading="lazy"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity p-1">
                        <p className="text-[10px] text-white truncate">
                          {image.image.split('/').pop()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {hasMore[label.id] && (
                <button
                  onClick={() => {
                    const nextPage = page[label.id] + 1;
                    setPage(prev => ({ ...prev, [label.id]: nextPage }));
                    fetchImages(label.id, nextPage);
                  }}
                  className="mt-3 text-sm font-medium text-teal-600 hover:text-teal-500"
                >
                  Load more images...
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
