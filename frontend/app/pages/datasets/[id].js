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
import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import Layout from '../../components/Layout';
import BulkUploadDialog from '../../components/BulkUploadDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import axios from 'axios';
import Spinner from '../../components/Spinner';
import theme from '../../theme';
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  CloudArrowUpIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  const value = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, value)).toFixed(value === 0 ? 0 : 1)} ${units[value]}`;
}

export default function DatasetDetail() {
  const [dataset, setDataset] = useState(null);
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState({});
  const [hasMore, setHasMore] = useState({});
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [openLabelMenuId, setOpenLabelMenuId] = useState(null);
  const [selectionModeByLabel, setSelectionModeByLabel] = useState({});
  const [selectedImagesByLabel, setSelectedImagesByLabel] = useState({});
  const [activeImage, setActiveImage] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [renameLabel, setRenameLabel] = useState('');

  const fileInputRefs = useRef({});
  const menuRef = useRef(null);

  const router = useRouter();
  const { id } = router.query;

  const datasetLocked = Boolean(dataset?.is_locked);
  const lockDetails = dataset?.lock_details || [];
  const lockTooltip = datasetLocked
    ? [
        'Locked by completed sessions:',
        ...lockDetails.map((item) => {
          const date = item.date ? new Date(item.date).toLocaleString() : 'unknown date';
          const type = item.type === 'training' ? 'Training' : 'Testing';
          return `- ${type}: ${item.name} (${date})`;
        }),
      ].join('\n')
    : '';

  const fetchImages = useCallback(async (labelId, pageNumber) => {
    try {
      const res = await fetch(`/api/datasets/image/?dataset=${id}&label=${labelId}&page=${pageNumber}`);
      const data = await res.json();
      setImages((prev) => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...(data.results || [])],
      }));
      setHasMore((prev) => ({
        ...prev,
        [labelId]: data.next !== null,
      }));
    } catch (error) {
      console.error('Failed to fetch images:', error);
    }
  }, [id]);



  const fetchGlobalSearch = useCallback(async (term, pageNumber = 1, append = false) => {
    if (!id || !term?.trim()) {
      setSearchResults([]);
      setSearchHasMore(false);
      return;
    }

    setSearchLoading(true);
    try {
      const query = encodeURIComponent(term.trim());
      const res = await fetch(`/api/datasets/image/?dataset=${id}&search=${query}&page=${pageNumber}`);
      const data = await res.json();
      const nextResults = data.results || [];

      setSearchResults((prev) => (append ? [...prev, ...nextResults] : nextResults));
      setSearchHasMore(Boolean(data.next));
      setSearchPage(pageNumber);
    } catch (error) {
      console.error('Failed to search images:', error);
    } finally {
      setSearchLoading(false);
    }
  }, [id]);

  const fetchAllData = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    try {
      const [datasetData, labelsData] = await Promise.all([
        fetch(`/api/datasets/dataset/${id}`).then((res) => res.json()),
        fetch(`/api/datasets/label/?datasets__id=${id}`).then((res) => res.json()),
      ]);

      setDataset(datasetData);
      setLabels(labelsData);

      const initialPages = {};
      const initialHasMore = {};
      const initialSelectionModes = {};
      const initialSelections = {};
      labelsData.forEach((label) => {
        initialPages[label.id] = 1;
        initialHasMore[label.id] = true;
        initialSelectionModes[label.id] = false;
        initialSelections[label.id] = [];
      });

      setPage(initialPages);
      setHasMore(initialHasMore);
      setSelectionModeByLabel(initialSelectionModes);
      setSelectedImagesByLabel(initialSelections);
      setImages({});

      for (const label of labelsData) {
        fetchImages(label.id, 1);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id, fetchImages]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenLabelMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);



  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      setSearchResults([]);
      setSearchHasMore(false);
      setSearchPage(1);
      return;
    }

    const debounceHandle = setTimeout(() => {
      fetchGlobalSearch(term, 1, false);
    }, 300);

    return () => clearTimeout(debounceHandle);
  }, [searchTerm, fetchGlobalSearch]);

  const handleUpload = async (files, labelId, datasetId) => {
    if (datasetLocked) return;

    const formData = new FormData();
    formData.append('label', labelId);
    formData.append('dataset', datasetId);
    Array.from(files || []).forEach((file) => formData.append('file', file));

    try {
      const response = await axios.post('/api/datasets/image/upload', formData);
      if (response.status !== 201 || !Array.isArray(response.data.images)) {
        throw new Error('Upload failed');
      }
      setImages((prev) => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...response.data.images],
      }));
    } catch (error) {
      console.error('Error uploading images:', error);
      alert(error?.response?.data?.message || 'Upload failed');
    }
  };

  const handleBulkUploadClose = () => {
    setShowBulkUpload(false);
    fetchAllData();
  };

  const toggleImageSelection = (labelId, imageId) => {
    setSelectedImagesByLabel((prev) => {
      const current = prev[labelId] || [];
      const exists = current.includes(imageId);
      return {
        ...prev,
        [labelId]: exists ? current.filter((id) => id !== imageId) : [...current, imageId],
      };
    });
  };

  const removeImages = async ({ labelId, imageIds = [], deleteAll = false }) => {
    try {
      const response = await fetch('/api/datasets/image/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: dataset.id,
          label_id: labelId,
          image_ids: imageIds,
          delete_all: deleteAll,
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.message || 'Delete failed');
      }

      if (deleteAll) {
        setImages((prev) => ({ ...prev, [labelId]: [] }));
      } else {
        setImages((prev) => ({
          ...prev,
          [labelId]: (prev[labelId] || []).filter((img) => !imageIds.includes(img.id)),
        }));
      }

      setSelectedImagesByLabel((prev) => ({ ...prev, [labelId]: [] }));
      setSelectionModeByLabel((prev) => ({ ...prev, [labelId]: false }));
      setOpenLabelMenuId(null);
    } catch (error) {
      console.error('Failed to remove images:', error);
      alert(error.message || 'Failed to remove images');
    }
  };

  const handleRenameLabel = async () => {
    if (!confirmAction?.labelId || !renameLabel.trim()) return;

    try {
      const response = await fetch(`/api/datasets/label/${confirmAction.labelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameLabel.trim() }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.message || 'Rename failed');
      }

      const updated = await response.json();
      setLabels((prev) => prev.map((label) => (label.id === updated.id ? { ...label, name: updated.name } : label)));
      setConfirmAction(null);
      setRenameLabel('');
      setOpenLabelMenuId(null);
    } catch (error) {
      console.error('Failed to rename label:', error);
      alert(error.message || 'Failed to rename label');
    }
  };

  const triggerAddImages = (labelId) => {
    const input = fileInputRefs.current[labelId];
    if (input) input.click();
    setOpenLabelMenuId(null);
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
      {showBulkUpload && (
        <BulkUploadDialog
          isOpen={showBulkUpload}
          onClose={handleBulkUploadClose}
          datasetId={dataset.id}
          labels={labels}
        />
      )}

      {confirmAction?.type === 'rename-label' && (
        <Transition.Root show={true} as={Fragment}>
          <Dialog as="div" className="relative z-50" onClose={() => setConfirmAction(null)}>
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
              <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-6">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                  enterTo="opacity-100 translate-y-0 sm:scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                  leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                >
                  <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:w-full sm:max-w-lg sm:p-6">
                    <Dialog.Title className="text-base font-semibold text-gray-900">Edit label name</Dialog.Title>
                    <input
                      value={renameLabel}
                      onChange={(e) => setRenameLabel(e.target.value)}
                      className={`${theme.classes.input} mt-4`}
                      placeholder="Label name"
                    />
                    <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
                      <button className={theme.classes.btnPrimary} onClick={handleRenameLabel}>Save</button>
                      <button className={theme.classes.btnSecondary} onClick={() => setConfirmAction(null)}>Cancel</button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition.Root>
      )}

      <ConfirmDialog
        open={confirmAction?.type === 'delete-selected' || confirmAction?.type === 'delete-all'}
        title={confirmAction?.type === 'delete-all' ? 'Delete all images in this class?' : 'Delete selected images?'}
        description={confirmAction?.type === 'delete-all'
          ? 'This will remove every image in this class. This cannot be undone.'
          : `This will remove ${confirmAction?.count || 0} selected image(s). This cannot be undone.`}
        confirmLabel={confirmAction?.type === 'delete-all' ? 'Delete all' : 'Delete selected'}
        confirmTone="danger"
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (!action) return;
          if (action.type === 'delete-all') {
            removeImages({ labelId: action.labelId, deleteAll: true });
          }
          if (action.type === 'delete-selected') {
            removeImages({ labelId: action.labelId, imageIds: action.imageIds, deleteAll: false });
          }
        }}
        onClose={() => setConfirmAction(null)}
      />

      <Transition.Root show={!!activeImage} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setActiveImage(null)}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/70 transition-opacity" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              >
                <Dialog.Panel className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <Dialog.Title className="text-base font-semibold text-gray-900">Image details</Dialog.Title>
                    <button className="rounded-md p-1 text-gray-500 hover:bg-gray-100" onClick={() => setActiveImage(null)}>
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                  {activeImage && (
                    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
                      <div className="rounded-lg bg-gray-100 p-3">
                        <img src={activeImage.image} alt={activeImage.file_name || 'dataset image'} className="mx-auto max-h-[420px] rounded-lg object-contain" />
                      </div>
                      <dl className="space-y-3 text-sm">
                        <div><dt className="font-medium text-gray-500">File name</dt><dd className="text-gray-900 break-all">{activeImage.file_name || activeImage.image?.split('/').pop()}</dd></div>
                        <div><dt className="font-medium text-gray-500">Format</dt><dd className="text-gray-900 uppercase">{activeImage.file_extension || 'Unknown'}</dd></div>
                        <div><dt className="font-medium text-gray-500">Resolution</dt><dd className="text-gray-900">{activeImage.image_width && activeImage.image_height ? `${activeImage.image_width} x ${activeImage.image_height}` : 'Unknown'}</dd></div>
                        <div><dt className="font-medium text-gray-500">Size</dt><dd className="text-gray-900">{formatBytes(activeImage.file_size)}</dd></div>
                        <div><dt className="font-medium text-gray-500">Label</dt><dd className="text-gray-900">{labels.find((l) => l.id === activeImage.label)?.name || activeImage.label}</dd></div>
                        <div><dt className="font-medium text-gray-500">Created</dt><dd className="text-gray-900">{new Date(activeImage.created_at).toLocaleString()}</dd></div>
                      </dl>
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      <div className="mb-6">
        <div className="flex items-center gap-x-3">
          <button onClick={() => router.push('/datasets')} className="text-sm text-gray-500 hover:text-gray-700">Datasets</button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-900">{dataset.name}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{dataset.name}</h1>
            {dataset.description && <p className="mt-1 text-sm text-gray-500">{dataset.description}</p>}
            {datasetLocked && (
              <div className="mt-2">
                <p
                  className="inline-flex rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/30"
                  title={lockTooltip}
                >
                  Locked - used in completed sessions
                </p>
                {lockDetails.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-amber-800">
                    {lockDetails.slice(0, 3).map((item, idx) => (
                      <li key={`${item.type}-${item.name}-${idx}`}>
                        {item.type === 'training' ? 'Training' : 'Testing'}: {item.name}
                        {item.date ? ` - ${new Date(item.date).toLocaleString()}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowBulkUpload(true)}
            className={`${datasetLocked ? theme.classes.btnDisabled : theme.classes.btnPrimary} flex items-center gap-2`}
            disabled={datasetLocked}
            title={datasetLocked ? lockTooltip : 'Upload images in bulk'}
          >
            <CloudArrowUpIcon className="h-5 w-5" />
            Bulk Upload
          </button>
        </div>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl mb-6 p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-gray-500">Resolution</dt>
            <dd className="mt-1 text-sm text-gray-900">{dataset.resolution}px</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Type</dt>
            <dd className="mt-1 text-sm text-gray-900">{dataset.base ? 'Base' : dataset.for_testing ? 'Testing' : 'Training'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Labels</dt>
            <dd className="mt-1 text-sm text-gray-900">{labels.length} categories</dd>
          </div>
        </dl>
      </div>



      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl mb-6 p-5">
        <div className="sm:flex sm:items-end sm:justify-between gap-3">
          <div className="sm:w-2/3">
            <label className="block text-sm font-medium text-gray-700">Search images by file name</label>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={`${theme.classes.input} mt-1.5`}
              placeholder="Example: shark_tooth_2026"
            />
            <p className="mt-1 text-xs text-gray-500">Supports partial names and searches across all classes.</p>
          </div>
          {searchTerm && (
            <button className={theme.classes.btnSecondary} onClick={() => setSearchTerm()}>
              Clear
            </button>
          )}
        </div>

        {searchTerm && (
          <div className="mt-4">
            {searchLoading && searchResults.length === 0 ? (
              <p className="text-sm text-gray-500">Searching...</p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-gray-500">No images match this file name.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-gray-600">{searchResults.length} result(s)</p>
                <div className="flex flex-wrap gap-3">
                  {searchResults.map((image) => {
                    const label = labels.find((item) => item.id === image.label);
                    return (
                      <button
                        key={`search-${image.id}`}
                        type="button"
                        className="relative group"
                        onClick={() => setActiveImage(image)}
                      >
                        <img
                          src={image.image}
                          alt={label?.name || 'search result'}
                          className="h-24 w-24 object-cover rounded-lg ring-1 ring-gray-200 hover:ring-teal-400"
                          loading="lazy"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent rounded-b-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-[10px] text-white truncate">{image.file_name || image.image.split('/').pop()}</p>
                          <p className="text-[10px] text-gray-200 truncate">{label?.name || 'Unknown class'}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {searchHasMore && (
                  <button
                    className="mt-3 text-sm font-medium text-teal-600 hover:text-teal-500"
                    onClick={() => fetchGlobalSearch(searchTerm, searchPage + 1, true)}
                    disabled={searchLoading}
                  >
                    {searchLoading ? 'Loading...' : 'Load more results...'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {labels.map((label) => {
          const currentImages = images[label.id] || [];
          const selected = selectedImagesByLabel[label.id] || [];
          const selectionMode = Boolean(selectionModeByLabel[label.id]);

          return (
            <div key={label.id} className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{label.name}</h3>
                  <p className="text-sm text-gray-500">{label.image_count} images</p>
                </div>
                <div className="relative" ref={openLabelMenuId === label.id ? menuRef : null}>
                  <button
                    type="button"
                    onClick={() => setOpenLabelMenuId(openLabelMenuId === label.id ? null : label.id)}
                    className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
                  >
                    <EllipsisVerticalIcon className="h-5 w-5" />
                  </button>
                  {openLabelMenuId === label.id && (
                    <div className="absolute right-0 z-10 mt-1 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5">
                      <div className="py-1">
                        <button
                          onClick={() => triggerAddImages(label.id)}
                          disabled={datasetLocked}
                          title={datasetLocked ? lockTooltip : 'Add images'}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          <ArrowUpTrayIcon className="h-4 w-4" /> Add images
                        </button>
                        <button
                          onClick={() => {
                            setConfirmAction({ type: 'rename-label', labelId: label.id });
                            setRenameLabel(label.name);
                            setOpenLabelMenuId(null);
                          }}
                          disabled={datasetLocked}
                          title={datasetLocked ? lockTooltip : 'Edit class name'}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          <PencilSquareIcon className="h-4 w-4" /> Edit class name
                        </button>
                        <button
                          onClick={() => {
                            setSelectionModeByLabel((prev) => ({ ...prev, [label.id]: !selectionMode }));
                            setOpenLabelMenuId(null);
                          }}
                          disabled={datasetLocked}
                          title={datasetLocked ? lockTooltip : (selectionMode ? 'Cancel selection' : 'Select images to remove')}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          <TrashIcon className="h-4 w-4" /> {selectionMode ? 'Cancel selection' : 'Select images to remove'}
                        </button>
                        <button
                          onClick={() => {
                            setConfirmAction({ type: 'delete-all', labelId: label.id });
                          }}
                          disabled={datasetLocked || currentImages.length === 0}
                          title={datasetLocked ? lockTooltip : 'Delete all in class'}
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                          <TrashIcon className="h-4 w-4" /> Delete all in class
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <input
                type="file"
                multiple
                className="hidden"
                ref={(el) => { fileInputRefs.current[label.id] = el; }}
                onChange={(e) => handleUpload(e.target.files, label.id, dataset.id)}
              />

              <div className="p-5">
                {selectionMode && (
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2">
                    <p className="text-sm text-gray-600">{selected.length} selected</p>
                    <button
                      className={theme.classes.btnDanger}
                      disabled={selected.length === 0}
                      onClick={() => setConfirmAction({ type: 'delete-selected', labelId: label.id, imageIds: selected, count: selected.length })}
                    >
                      Remove selected
                    </button>
                  </div>
                )}

                {currentImages.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No images uploaded yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {currentImages.map((image) => (
                      <div key={image.id} className="relative group">
                        {selectionMode && !datasetLocked && (
                          <button
                            type="button"
                            onClick={() => toggleImageSelection(label.id, image.id)}
                            className={`absolute left-1 top-1 z-10 h-5 w-5 rounded border ${selected.includes(image.id) ? 'bg-teal-600 border-teal-600' : 'bg-white border-gray-300'}`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveImage(image)}
                          className="block"
                          title="View image details"
                        >
                          <img
                            src={image.image}
                            alt={label.name}
                            className={`h-24 w-24 object-cover rounded-lg ring-1 ${selected.includes(image.id) ? 'ring-teal-600 ring-2' : 'ring-gray-200'} hover:ring-teal-400`}
                            loading="lazy"
                          />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity p-1">
                          <p className="text-[10px] text-white truncate">{image.file_name || image.image.split('/').pop()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {hasMore[label.id] && (
                  <button
                    onClick={() => {
                      const nextPage = (page[label.id] || 1) + 1;
                      setPage((prev) => ({ ...prev, [label.id]: nextPage }));
                      fetchImages(label.id, nextPage);
                    }}
                    className="mt-3 text-sm font-medium text-teal-600 hover:text-teal-500"
                  >
                    Load more images...
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
