/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: augmentation/index.js
 * Copyright (c) 2024
 */

import { useState, useEffect, useCallback } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../contexts/AuthContext';
import Spinner from '../../components/Spinner';
import Image from 'next/image';
import theme from '../../theme';

const AUGMENTATION_FLAGS = [
  { key: 'grayscale', label: 'Grayscale' },
  { key: 'random_grayscale', label: 'Random Grayscale (50%)' },
  { key: 'horizontal_flip', label: 'Horizontal Flip' },
  { key: 'vertical_flip', label: 'Vertical Flip' },
  { key: 'random_rotation', label: 'Random Rotation (±15°)' },
  { key: 'zoom', label: 'Random Zoom (5-15%)' },
  { key: 'brightness_contrast', label: 'Brightness & Contrast (±10%)' },
  { key: 'random_crop', label: 'Random Crop & Resize' },
  { key: 'gaussian_noise', label: 'Gaussian Noise (2%)' },
  { key: 'blur', label: 'Gaussian Blur' },
  { key: 'cutout', label: 'Cutout (20x20)' },
];

export default function AugmentationPreview() {
  const { user } = useAuth();

  // Access control
  const [showSyntheticTools, setShowSyntheticTools] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  // Data selectors
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [labels, setLabels] = useState([]);
  const [selectedLabelId, setSelectedLabelId] = useState('');
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState('');

  // Augmentation config
  const [config, setConfig] = useState(
    Object.fromEntries(AUGMENTATION_FLAGS.map(f => [f.key, false]))
  );
  const [previewCount, setPreviewCount] = useState(6);

  // Preview results
  const [generating, setGenerating] = useState(false);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [error, setError] = useState(null);

  // Check access
  useEffect(() => {
    fetch('/api/feature_extractor/site-settings/')
      .then(r => r.json())
      .then(data => {
        setShowSyntheticTools(data.show_synthetic_tools || false);
        setAccessChecked(true);
      })
      .catch(() => setAccessChecked(true));
  }, []);

  const canAccess = user?.isSuperuser || showSyntheticTools;

  // Fetch datasets
  useEffect(() => {
    if (!canAccess) return;
    fetch('/api/datasets/dataset/')
      .then(r => r.json())
      .then(data => setDatasets(Array.isArray(data) ? data : data.results || []))
      .catch(console.error);
  }, [canAccess]);

  // Fetch labels when dataset changes
  useEffect(() => {
    if (!selectedDatasetId) {
      setLabels([]);
      setSelectedLabelId('');
      return;
    }
    fetch(`/api/datasets/label/?datasets__id=${selectedDatasetId}`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data.results || [];
        setLabels(list);
        setSelectedLabelId('');
        setImages([]);
        setSelectedImageId('');
      })
      .catch(console.error);
  }, [selectedDatasetId]);

  // Fetch images when label changes
  useEffect(() => {
    if (!selectedDatasetId || !selectedLabelId) {
      setImages([]);
      setSelectedImageId('');
      return;
    }
    fetch(`/api/datasets/image/?dataset=${selectedDatasetId}&label=${selectedLabelId}&page_size=100`)
      .then(r => r.json())
      .then(data => {
        const list = data.results || [];
        setImages(list);
        setSelectedImageId('');
      })
      .catch(console.error);
  }, [selectedDatasetId, selectedLabelId]);

  const toggleFlag = (key) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const anyFlagEnabled = Object.values(config).some(Boolean);

  const handleGenerate = async () => {
    if (!selectedImageId || !anyFlagEnabled) return;
    setGenerating(true);
    setError(null);
    setPreviewUrls([]);
    setOriginalUrl(null);

    try {
      const res = await fetch(`/api/datasets/image/${selectedImageId}/augmentation-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, count: previewCount }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to generate previews');
      }
      const data = await res.json();
      setOriginalUrl(data.original);
      setPreviewUrls(data.previews || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  if (!accessChecked) return <Layout><Spinner /></Layout>;

  if (!canAccess) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-gray-500">This feature is not available. Contact your administrator.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Augmentation Preview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select an image and augmentation settings to preview how transforms will look during training.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: selectors and controls */}
        <div className="space-y-4">
          {/* Image selector */}
          <div className={theme.classes.card}>
            <div className="px-5 py-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Select Image</h3>

              <div>
                <label className="text-xs font-medium text-gray-500">Dataset</label>
                <select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  className={`mt-1 block w-full ${theme.classes.input}`}
                >
                  <option value="">Choose a dataset...</option>
                  {datasets.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500">Species / Label</label>
                <select
                  value={selectedLabelId}
                  onChange={(e) => setSelectedLabelId(e.target.value)}
                  className={`mt-1 block w-full ${theme.classes.input}`}
                  disabled={!selectedDatasetId}
                >
                  <option value="">Choose a label...</option>
                  {labels.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.image_count})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500">Image</label>
                <select
                  value={selectedImageId}
                  onChange={(e) => setSelectedImageId(e.target.value)}
                  className={`mt-1 block w-full ${theme.classes.input}`}
                  disabled={!selectedLabelId}
                >
                  <option value="">Choose an image...</option>
                  {images.map(img => (
                    <option key={img.id} value={img.id}>
                      {img.file_name || `Image #${img.id}`}
                      {img.completeness != null ? ` (${Math.round(img.completeness * 100)}%)` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Augmentation flags */}
          <div className={theme.classes.card}>
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Augmentation Settings</h3>
              <div className="space-y-2">
                {AUGMENTATION_FLAGS.map(flag => (
                  <label key={flag.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config[flag.key]}
                      onChange={() => toggleFlag(flag.key)}
                      className={theme.classes.checkbox}
                    />
                    <span className="text-sm text-gray-700">{flag.label}</span>
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium text-gray-500">Preview Count</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={previewCount}
                  onChange={(e) => setPreviewCount(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                  className={`mt-1 block w-20 ${theme.classes.input}`}
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={!selectedImageId || !anyFlagEnabled || generating}
                className={`mt-4 w-full ${
                  !selectedImageId || !anyFlagEnabled || generating
                    ? theme.classes.btnDisabled
                    : theme.classes.btnPrimary
                }`}
              >
                {generating ? 'Generating...' : 'Generate Preview'}
              </button>
            </div>
          </div>
        </div>

        {/* Right panel: preview results */}
        <div className="lg:col-span-2">
          {error && (
            <div className="rounded-md bg-red-50 p-4 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {generating && (
            <div className="flex items-center justify-center py-12">
              <Spinner />
              <span className="ml-3 text-sm text-gray-500">Generating augmented previews...</span>
            </div>
          )}

          {!generating && originalUrl && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">
                Original vs Augmented ({previewUrls.length} previews)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {/* Original */}
                <div className="relative">
                  <div className="absolute left-1 top-1 z-10 rounded bg-blue-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    Original
                  </div>
                  <Image
                    src={originalUrl}
                    alt="Original"
                    width={192}
                    height={192}
                    unoptimized
                    className="w-full aspect-square object-cover rounded-lg ring-2 ring-blue-400"
                  />
                </div>
                {/* Augmented previews */}
                {previewUrls.map((url, idx) => (
                  <div key={idx} className="relative">
                    <div className="absolute left-1 top-1 z-10 rounded bg-gray-800/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      #{idx + 1}
                    </div>
                    <Image
                      src={url}
                      alt={`Augmented #${idx + 1}`}
                      width={192}
                      height={192}
                      unoptimized
                      className="w-full aspect-square object-cover rounded-lg ring-1 ring-gray-200"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!generating && !originalUrl && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-gray-100 p-4 mb-4">
                <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">Select an image and enable at least one augmentation to generate previews.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
