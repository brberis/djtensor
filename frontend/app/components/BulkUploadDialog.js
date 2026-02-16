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
} from '@heroicons/react/24/outline';
import theme from '../theme';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'];
const ARCHIVE_TYPES = ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-gzip'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'];
const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz'];
const CHUNK_SIZE = 50; // images per upload request
const MAX_PREVIEW_COUNT = 500; // only generate thumbnails for the first N to avoid browser freeze

function getFileExtension(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz')) return '.tar.gz';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

function isImageFile(file) {
  if (IMAGE_TYPES.includes(file.type)) return true;
  return IMAGE_EXTENSIONS.includes(getFileExtension(file.name));
}

function isArchiveFile(file) {
  if (ARCHIVE_TYPES.includes(file.type)) return true;
  return ARCHIVE_EXTENSIONS.includes(getFileExtension(file.name));
}

export default function BulkUploadDialog({ isOpen, onClose, datasetId, labels }) {
  const [open, setOpen] = useState(isOpen);
  const [selectedLabel, setSelectedLabel] = useState(labels.length > 0 ? labels[0].id : '');
  const [files, setFiles] = useState([]);          // { file, preview, id }
  const [archives, setArchives] = useState([]);     // { file, id }
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { current, total, phase }
  const [results, setResults] = useState(null);     // { created, duplicates, errors }
  const [archiveTaskId, setArchiveTaskId] = useState(null);
  const [archiveStatus, setArchiveStatus] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const nextIdRef = useRef(0);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  const addFiles = useCallback((newFiles) => {
    const imageItems = [];
    const archiveItems = [];

    Array.from(newFiles).forEach(file => {
      const id = nextIdRef.current++;
      if (isArchiveFile(file)) {
        archiveItems.push({ file, id });
      } else if (isImageFile(file)) {
        // Only create previews for the first MAX_PREVIEW_COUNT images
        const currentCount = files.length + imageItems.length;
        const preview = currentCount < MAX_PREVIEW_COUNT ? URL.createObjectURL(file) : null;
        imageItems.push({ file, preview, id });
      }
      // Skip non-image, non-archive files silently
    });

    if (imageItems.length > 0) {
      setFiles(prev => [...prev, ...imageItems]);
    }
    if (archiveItems.length > 0) {
      setArchives(prev => [...prev, ...archiveItems]);
    }
  }, [files.length]);

  const removeFile = (id) => {
    setFiles(prev => {
      const item = prev.find(f => f.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter(f => f.id !== id);
    });
  };

  const removeArchive = (id) => {
    setArchives(prev => prev.filter(a => a.id !== id));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileSelect = (e) => {
    if (e.target.files?.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same files can be re-selected
    }
  };

  // Upload images in chunks
  const uploadImages = async () => {
    if (!selectedLabel) return;
    setUploading(true);
    setResults(null);
    setArchiveStatus(null);

    const allCreated = [];
    const allDuplicates = [];
    const allErrors = [];

    // Upload individual images in chunks
    if (files.length > 0) {
      const totalChunks = Math.ceil(files.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        const chunk = files.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        setUploadProgress({
          current: i * CHUNK_SIZE,
          total: files.length,
          phase: `Uploading chunk ${i + 1}/${totalChunks}...`,
        });

        const formData = new FormData();
        formData.append('dataset_id', datasetId);
        formData.append('label_id', selectedLabel);
        chunk.forEach(item => formData.append('image', item.file));

        try {
          const res = await fetch('/api/datasets/image/bulk-upload', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (data.created) allCreated.push(...data.created);
          if (data.duplicates) allDuplicates.push(...data.duplicates);
          if (data.errors) allErrors.push(...data.errors);
        } catch (err) {
          // If a chunk fails entirely, record errors for each file in it
          chunk.forEach(item => allErrors.push({ file: item.file.name, reason: err.message }));
        }
      }
    }

    // Upload archives one at a time
    for (const archive of archives) {
      setUploadProgress({
        current: files.length,
        total: files.length + archives.length,
        phase: `Uploading archive: ${archive.file.name}...`,
      });

      const formData = new FormData();
      formData.append('dataset_id', datasetId);
      formData.append('label_id', selectedLabel);
      formData.append('archive', archive.file);

      try {
        const res = await fetch('/api/datasets/image/bulk-upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.task_id) {
          setArchiveTaskId(data.task_id);
          // Start polling for archive processing status
          pollArchiveStatus(data.task_id);
        }
      } catch (err) {
        allErrors.push({ file: archive.file.name, reason: err.message });
      }
    }

    setResults({
      created: allCreated,
      duplicates: allDuplicates,
      errors: allErrors,
    });
    setUploadProgress(null);
    if (archives.length === 0) {
      setUploading(false);
    }
  };

  const pollArchiveStatus = async (taskId) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/datasets/image/upload-status?task_id=${taskId}`);
        const data = await res.json();
        setArchiveStatus(data);

        if (data.status === 'completed' || data.status === 'failed' || data.status === 'SUCCESS' || data.status === 'FAILURE') {
          setUploading(false);
          // Merge archive results if available
          if (data.result) {
            setResults(prev => {
              if (!prev) return data.result;
              return {
                created: [...(prev.created || []), ...(data.result.created || [])],
                duplicates: [...(prev.duplicates || []), ...(data.result.duplicates || [])],
                errors: [...(prev.errors || []), ...(data.result.errors || [])],
              };
            });
          }
          return;
        }
        // Keep polling
        setTimeout(poll, 2000);
      } catch (err) {
        console.error('Polling error:', err);
        setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const totalFileCount = files.length + archives.length;
  const hasFiles = totalFileCount > 0;

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500/75 transition-opacity" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300" enterFrom="opacity-0 translate-y-4 sm:scale-95" enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200" leaveFrom="opacity-100 translate-y-0 sm:scale-100" leaveTo="opacity-0 translate-y-4 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl">
                {/* Header */}
                <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100">
                  <div>
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      Bulk Upload Images
                    </Dialog.Title>
                    <p className="mt-1 text-sm text-gray-500">
                      Drag and drop images or archives. Duplicates are automatically skipped.
                    </p>
                  </div>
                  <button type="button" className="rounded-md bg-white text-gray-400 hover:text-gray-500" onClick={handleClose}>
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                  {/* Label selector */}
                  <div>
                    <label className={theme.classes.label}>Target Label</label>
                    <select
                      value={selectedLabel}
                      onChange={(e) => setSelectedLabel(e.target.value)}
                      className={`mt-1.5 ${theme.classes.select}`}
                      disabled={uploading}
                    >
                      {labels.map(label => (
                        <option key={label.id} value={label.id}>{label.name} ({label.image_count} images)</option>
                      ))}
                    </select>
                  </div>

                  {/* Drop zone */}
                  {!uploading && !results && (
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                        dragOver ? 'border-teal-500 bg-teal-50' : 'border-gray-300 hover:border-gray-400'
                      }`}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ArrowUpTrayIcon className="mx-auto h-10 w-10 text-gray-400" />
                      <p className="mt-2 text-sm font-medium text-gray-900">
                        Drop files here or click to browse
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        JPEG, PNG, WebP, BMP, TIFF images or ZIP/TAR.GZ archives
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.zip,.tar,.tar.gz,.tgz"
                        className="sr-only"
                        onChange={handleFileSelect}
                      />
                    </div>
                  )}

                  {/* File count summary */}
                  {hasFiles && !results && (
                    <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                      <span className="text-sm text-gray-700">
                        <strong>{files.length}</strong> image{files.length !== 1 ? 's' : ''}
                        {archives.length > 0 && (
                          <> + <strong>{archives.length}</strong> archive{archives.length !== 1 ? 's' : ''}</>
                        )}
                      </span>
                      {!uploading && (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm text-teal-600 hover:text-teal-500 font-medium flex items-center gap-1"
                        >
                          <PlusIcon className="h-4 w-4" /> Add more
                        </button>
                      )}
                    </div>
                  )}

                  {/* Archive list */}
                  {archives.length > 0 && !results && (
                    <div className="space-y-2">
                      {archives.map(a => (
                        <div key={a.id} className="flex items-center justify-between bg-amber-50 rounded-lg px-4 py-2">
                          <div className="flex items-center gap-2">
                            <ArchiveBoxIcon className="h-5 w-5 text-amber-600" />
                            <span className="text-sm text-gray-900">{a.file.name}</span>
                            <span className="text-xs text-gray-500">({(a.file.size / (1024 * 1024)).toFixed(1)} MB)</span>
                          </div>
                          {!uploading && (
                            <button onClick={() => removeArchive(a.id)} className="text-gray-400 hover:text-red-500">
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Thumbnail preview grid */}
                  {files.length > 0 && !results && (
                    <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2 max-h-64 overflow-y-auto">
                      {files.slice(0, MAX_PREVIEW_COUNT).map(item => (
                        <div key={item.id} className="relative group aspect-square">
                          {item.preview ? (
                            <img
                              src={item.preview}
                              alt={item.file.name}
                              className="h-full w-full object-cover rounded ring-1 ring-gray-200"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-full w-full bg-gray-100 rounded flex items-center justify-center">
                              <PhotoIcon className="h-5 w-5 text-gray-400" />
                            </div>
                          )}
                          {!uploading && (
                            <button
                              onClick={() => removeFile(item.id)}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <XMarkIcon className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      {files.length > MAX_PREVIEW_COUNT && (
                        <div className="aspect-square bg-gray-100 rounded flex items-center justify-center">
                          <span className="text-xs text-gray-500 text-center">
                            +{files.length - MAX_PREVIEW_COUNT} more
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upload progress */}
                  {uploading && uploadProgress && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{uploadProgress.phase}</span>
                        <span className="text-gray-500">
                          {uploadProgress.current}/{uploadProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-teal-600 h-2 rounded-full transition-all"
                          style={{ width: `${Math.round((uploadProgress.current / Math.max(uploadProgress.total, 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Archive processing progress */}
                  {uploading && archiveStatus && archiveStatus.status === 'PROGRESS' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{archiveStatus.message}</span>
                        <span className="text-gray-500">{archiveStatus.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-amber-500 h-2 rounded-full transition-all"
                          style={{ width: `${archiveStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Results summary */}
                  {results && (
                    <div className="space-y-3">
                      <div className="rounded-lg bg-green-50 p-4">
                        <div className="flex items-center gap-2">
                          <CheckCircleIcon className="h-5 w-5 text-green-600" />
                          <span className="text-sm font-medium text-green-800">Upload Complete</span>
                        </div>
                        <ul className="mt-2 text-sm text-green-700 space-y-1">
                          <li>{results.created?.length || 0} images created</li>
                          {(results.duplicates?.length || 0) > 0 && (
                            <li>{results.duplicates.length} duplicates skipped</li>
                          )}
                          {(results.errors?.length || 0) > 0 && (
                            <li className="text-amber-700">{results.errors.length} errors</li>
                          )}
                        </ul>
                      </div>

                      {results.errors?.length > 0 && (
                        <div className="rounded-lg bg-red-50 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                            <span className="text-sm font-medium text-red-800">Errors</span>
                          </div>
                          <ul className="text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                            {results.errors.slice(0, 20).map((err, i) => (
                              <li key={i}>{err.file}: {err.reason}</li>
                            ))}
                            {results.errors.length > 20 && (
                              <li>...and {results.errors.length - 20} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer buttons */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                  <button type="button" onClick={handleClose} className={theme.classes.btnSecondary}>
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
