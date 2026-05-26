/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: BulkUploadDialog.js
 * Copyright (c) 2024
 *
 * Drag-and-drop bulk image upload dialog.
 * Supports individual image files and archives (zip, tar.gz).
 * Uploads in chunks to avoid timeouts and memory issues at scale.
 */

import { Fragment, useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  XMarkIcon,
  ArrowUpTrayIcon,
  ArchiveBoxIcon,
  PhotoIcon,
  TrashIcon,
  PlusIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import theme from '../theme';

const CHUNK_SIZE = 50;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
const ACCEPTED_ARCHIVE_TYPES = [
  'application/zip', 'application/x-zip-compressed',
  'application/gzip', 'application/x-gzip',
  'application/x-tar', 'application/x-compressed-tar',
];
const ACCEPTED_EXTENSIONS = ['.zip', '.tar.gz', '.tgz', '.tar'];

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isArchiveFile(file) {
  if (ACCEPTED_ARCHIVE_TYPES.includes(file.type)) return true;
  return ACCEPTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
}

export default function BulkUploadDialog({ isOpen, onClose, datasetId }) {
  const [open, setOpen] = useState(isOpen);
  const [imageFiles, setImageFiles] = useState([]);
  const [archiveFiles, setArchiveFiles] = useState([]);
  const [labels, setLabels] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentFile: '' });
  const [results, setResults] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [datasetResolution, setDatasetResolution] = useState(null);
  const fileInputRef = useRef(null);
  const archiveInputRef = useRef(null);

  const preserveOriginal = String(datasetResolution || '').toLowerCase() === 'original';
  const maxFileSizeMb = preserveOriginal ? 200 : 20;
  const [sourceKind, setSourceKind] = useState('auto'); // auto | raw | masked | processed

  useEffect(() => {
    async function fetchLabels() {
      try {
        const res = await fetch('/api/datasets/label/');
        const data = await res.json();
        setLabels(data);
      } catch (err) {
        console.error('Failed to fetch labels:', err);
      }
    }
    async function fetchDataset() {
      if (!datasetId) return;
      try {
        const res = await fetch(`/api/datasets/dataset/${datasetId}/`);
        const data = await res.json();
        setDatasetResolution(data?.resolution || null);
      } catch (err) {
        console.error('Failed to fetch dataset:', err);
      }
    }
    if (isOpen) {
      fetchLabels();
      fetchDataset();
    }
  }, [isOpen, datasetId]);

  const handleClose = (result) => {
    if (uploading) return;
    setOpen(false);
    setImageFiles([]);
    setArchiveFiles([]);
    setSelectedLabel('');
    setResults(null);
    setProgress({ current: 0, total: 0, currentFile: '' });
    onClose(result || false);
  };

  const addFiles = useCallback((newFiles) => {
    const fileArray = Array.from(newFiles);
    const images = fileArray.filter(f => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const archives = fileArray.filter(f => isArchiveFile(f));
    if (images.length) setImageFiles(prev => [...prev, ...images]);
    if (archives.length) setArchiveFiles(prev => [...prev, ...archives]);
  }, []);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const removeImage = (index) => setImageFiles(prev => prev.filter((_, i) => i !== index));
  const removeArchive = (index) => setArchiveFiles(prev => prev.filter((_, i) => i !== index));
  const clearAll = () => { setImageFiles([]); setArchiveFiles([]); };

  const totalFileCount = imageFiles.length + archiveFiles.length;
  const totalSize = [...imageFiles, ...archiveFiles].reduce((acc, f) => acc + f.size, 0);
  const hasFiles = totalFileCount > 0;

  const uploadImages = async () => {
    if (!hasFiles || !selectedLabel) return;
    setUploading(true);
    const allResults = { success: 0, failed: 0, errors: [] };

    // Upload archives first
    for (let i = 0; i < archiveFiles.length; i++) {
      const file = archiveFiles[i];
      setProgress({ current: i + 1, total: archiveFiles.length + Math.ceil(imageFiles.length / CHUNK_SIZE), currentFile: file.name });
      const formData = new FormData();
      formData.append('archive', file);
      formData.append('label_id', selectedLabel);
      if (datasetId) formData.append('dataset_id', datasetId);
      if (preserveOriginal && sourceKind && sourceKind !== 'auto') formData.append('source_kind', sourceKind);
      try {
        const res = await fetch('/api/datasets/image/bulk-upload-archive/', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          allResults.success += data.success_count || 0;
          allResults.failed += data.error_count || 0;
        } else {
          allResults.failed++;
          allResults.errors.push(`Archive ${file.name}: upload failed`);
        }
      } catch {
        allResults.failed++;
        allResults.errors.push(`Archive ${file.name}: network error`);
      }
    }

    // Upload image chunks
    const archiveCount = archiveFiles.length;
    for (let i = 0; i < imageFiles.length; i += CHUNK_SIZE) {
      const chunk = imageFiles.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(imageFiles.length / CHUNK_SIZE);
      setProgress({ current: archiveCount + chunkNum, total: archiveCount + totalChunks, currentFile: `Chunk ${chunkNum}/${totalChunks}` });
      const formData = new FormData();
      chunk.forEach(file => formData.append('images', file));
      formData.append('label_id', selectedLabel);
      if (datasetId) formData.append('dataset_id', datasetId);
      if (preserveOriginal && sourceKind && sourceKind !== 'auto') formData.append('source_kind', sourceKind);
      try {
        const res = await fetch('/api/datasets/image/bulk-upload/', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          allResults.success += data.success_count || chunk.length;
        } else {
          allResults.failed += chunk.length;
        }
      } catch {
        allResults.failed += chunk.length;
      }
    }

    setResults(allResults);
    setUploading(false);
  };

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !uploading && handleClose(false)}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-2xl transform rounded-lg bg-white shadow-xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    Bulk Upload Images
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={() => handleClose(false)}
                    disabled={uploading}
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5">
                  {preserveOriginal && (
                    <div className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                      <strong>Original resolution dataset.</strong> Images will be saved at full resolution (no resize, no crop). Per-file limit: {maxFileSizeMb} MB. This is the right mode for Phase 2 source uploads (Raw or Masked photos with a scale bar visible).
                    </div>
                  )}
                  {/* Alert */}
                  {results && (
                    <div className={`mb-4 rounded-md p-4 ${results.failed > 0 ? 'bg-yellow-50' : 'bg-green-50'}`}>
                      <div className="flex">
                        {results.failed > 0 ? (
                          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
                        ) : (
                          <CheckCircleIcon className="h-5 w-5 text-green-400" />
                        )}
                        <div className="ml-3">
                          <p className={`text-sm font-medium ${results.failed > 0 ? 'text-yellow-800' : 'text-green-800'}`}>
                            {results.success} uploaded successfully{results.failed > 0 ? `, ${results.failed} failed` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Label selector */}
                  <div className="mb-4">
                    <label htmlFor="upload-label" className={theme.classes.label}>Target Label</label>
                    <select
                      id="upload-label"
                      value={selectedLabel}
                      onChange={(e) => setSelectedLabel(e.target.value)}
                      className={`mt-1.5 ${theme.classes.select}`}
                      disabled={uploading}
                    >
                      <option value="">Select a label...</option>
                      {labels.map((label) => (
                        <option key={label.id} value={label.id}>{label.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Source-kind selector - only shown on Phase 2 source ('original') datasets */}
                  {preserveOriginal && (
                    <div className="mb-4">
                      <label htmlFor="upload-source-kind" className={theme.classes.label}>Source type</label>
                      <select
                        id="upload-source-kind"
                        value={sourceKind}
                        onChange={(e) => setSourceKind(e.target.value)}
                        className={`mt-1.5 ${theme.classes.select}`}
                        disabled={uploading}
                      >
                        <option value="auto">Auto-detect from filename (RAW_ / MASKED_ / PROCESSED_)</option>
                        <option value="raw">RAW — camera original, catalog label visible (OCR works)</option>
                        <option value="masked">MASKED — background removed, no catalog label (OCR skipped)</option>
                        <option value="processed">PROCESSED — 384×384 model-ready, no scale bar</option>
                      </select>
                      <p className="mt-1.5 text-[11px] text-gray-500">
                        Tells the pipeline whether to expect OCR / mm calibration on these files. Auto-detect uses the file-name prefix.
                      </p>
                    </div>
                  )}

                  {/* Drop zone */}
                  {!results && (
                    <div
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                      className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                        dragActive
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <ArrowUpTrayIcon className="mx-auto h-10 w-10 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-600">Drag and drop images or archives here, or</p>
                      <div className="mt-3 flex justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                        >
                          <PhotoIcon className="h-4 w-4" /> Images
                        </button>
                        <button
                          type="button"
                          onClick={() => archiveInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                        >
                          <ArchiveBoxIcon className="h-4 w-4" /> Archives
                        </button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={ACCEPTED_IMAGE_TYPES.join(',')}
                        className="hidden"
                        onChange={(e) => addFiles(e.target.files)}
                      />
                      <input
                        ref={archiveInputRef}
                        type="file"
                        multiple
                        accept=".zip,.tar.gz,.tgz,.tar"
                        className="hidden"
                        onChange={(e) => addFiles(e.target.files)}
                      />
                    </div>
                  )}

                  {/* File list */}
                  {hasFiles && !results && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-medium text-gray-700">
                          {totalFileCount} file{totalFileCount !== 1 ? 's' : ''} ({formatFileSize(totalSize)})
                        </p>
                        <button
                          type="button"
                          onClick={clearAll}
                          disabled={uploading}
                          className="text-sm text-red-600 hover:text-red-500"
                        >
                          Clear all
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
                        {archiveFiles.map((file, idx) => (
                          <div key={`a-${idx}`} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-b-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <ArchiveBoxIcon className="h-4 w-4 text-amber-500 shrink-0" />
                              <span className="text-sm text-gray-700 truncate">{file.name}</span>
                              <span className="text-xs text-gray-400 shrink-0">{formatFileSize(file.size)}</span>
                            </div>
                            <button onClick={() => removeArchive(idx)} disabled={uploading} className="text-gray-400 hover:text-red-500">
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        {imageFiles.slice(0, 100).map((file, idx) => (
                          <div key={`i-${idx}`} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-b-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <PhotoIcon className="h-4 w-4 text-blue-500 shrink-0" />
                              <span className="text-sm text-gray-700 truncate">{file.name}</span>
                              <span className="text-xs text-gray-400 shrink-0">{formatFileSize(file.size)}</span>
                            </div>
                            <button onClick={() => removeImage(idx)} disabled={uploading} className="text-gray-400 hover:text-red-500">
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        {imageFiles.length > 100 && (
                          <div className="px-3 py-2 text-sm text-gray-500 text-center">
                            ... and {imageFiles.length - 100} more images
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Progress bar */}
                  {uploading && (
                    <div className="mt-4">
                      <div className="flex justify-between text-sm text-gray-600 mb-1">
                        <span>{progress.currentFile}</span>
                        <span>{progress.current}/{progress.total}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-200">
                        <div
                          className="h-2 rounded-full bg-blue-600 transition-all"
                          style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => handleClose(results ? true : false)}
                    disabled={uploading}
                    className={theme.classes.btnSecondary}
                  >
                    {results ? 'Done' : 'Cancel'}
                  </button>
                  {!results && (
                    <button
                      onClick={uploadImages}
                      disabled={!hasFiles || !selectedLabel || uploading}
                      className={hasFiles && selectedLabel && !uploading ? theme.classes.btnPrimary : theme.classes.btnDisabled}
                    >
                      {uploading ? 'Uploading...' : `Upload ${totalFileCount} file${totalFileCount !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
