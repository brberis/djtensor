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
import { useAuth } from '../../contexts/AuthContext';
import axios from 'axios';
import Spinner from '../../components/Spinner';
import Image from 'next/image';
import theme from '../../theme';
import {
  ArrowUpTrayIcon,
  PhotoIcon,
  CloudArrowUpIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid';

const AUGMENTATION_FLAGS = [
  { key: 'grayscale', label: 'Grayscale' },
  { key: 'random_grayscale', label: 'Random Grayscale (50%)' },
  { key: 'horizontal_flip', label: 'Horizontal Flip' },
  { key: 'vertical_flip', label: 'Vertical Flip' },
  { key: 'random_rotation', label: 'Random Rotation (\u00b115\u00b0)' },
  { key: 'zoom', label: 'Random Zoom (5-15%)' },
  { key: 'brightness_contrast', label: 'Brightness & Contrast (\u00b110%)' },
  { key: 'random_crop', label: 'Random Crop & Resize' },
  { key: 'gaussian_noise', label: 'Gaussian Noise (2%)' },
  { key: 'blur', label: 'Gaussian Blur' },
  { key: 'cutout', label: 'Cutout (20x20)' },
];

// Wrapper that shows an Archived placeholder when the image file is missing
function ArchivedImage({ src, alt, width, height, className, ...rest }) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={className}
        style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', borderRadius: '0.5rem' }}
      >
        <span className="text-xs text-gray-400 font-medium">Archived</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      unoptimized
      className={className}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

const normalizeMediaUrl = (value) => {
  if (!value) return null;
  if (value.startsWith("http") || value.startsWith("/")) return value;
  return "/media/" + value;
};

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
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);

  const [showSyntheticTools, setShowSyntheticTools] = useState(false);
  const [computingCompleteness, setComputingCompleteness] = useState(false);
  const [showCompletenessDialog, setShowCompletenessDialog] = useState(false);
  const [allDatasets, setAllDatasets] = useState([]);
  const [referenceDatasetId, setReferenceDatasetId] = useState('');
  const [showSyntheticDialog, setShowSyntheticDialog] = useState(false);
  const [syntheticName, setSyntheticName] = useState('');
  const [syntheticBins, setSyntheticBins] = useState([0.8, 0.6, 0.4]);
  const [syntheticImagesPerBin, setSyntheticImagesPerBin] = useState(10);
  const [syntheticUseAllSources, setSyntheticUseAllSources] = useState(false);
  const [generatingSynthetic, setGeneratingSynthetic] = useState(false);
  const [fractureProfiles, setFractureProfiles] = useState(null);
  const [profileOverrides, setProfileOverrides] = useState({});
  const [expandedSpecies, setExpandedSpecies] = useState(null);
  const [showDeleteDataset, setShowDeleteDataset] = useState(false);
  const [deletingDataset, setDeletingDataset] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showParamHelp, setShowParamHelp] = useState(false);
  const [selectedTransformations, setSelectedTransformations] = useState({ fragments: false });
  const [imageViewMode, setImageViewMode] = useState('transformed'); // 'transformed', 'original', 'side-by-side'
  const [regenerating, setRegenerating] = useState(false);

  const fileInputRefs = useRef({});
  const menuRef = useRef(null);
  const actionsMenuRef = useRef(null);

  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();

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

  // Sync the navbar study selector to this dataset's study so a shared dataset
  // URL lands the recipient in the correct study context (one-time reload).
  useEffect(() => {
    if (!user || !dataset?.study) return;
    if (typeof window === 'undefined') return;
    const datasetStudy = String(dataset.study);
    const current = localStorage.getItem(`selectedStudy_${user.id}`)
      || localStorage.getItem('selectedStudy');
    if (current !== datasetStudy) {
      localStorage.setItem(`selectedStudy_${user.id}`, datasetStudy);
      localStorage.setItem('selectedStudy', datasetStudy);
      window.location.reload();
    }
  }, [user, dataset?.study]);

  useEffect(() => {
    fetch('/api/feature_extractor/site-settings/')
      .then(r => r.json())
      .then(data => {
        if (data.show_synthetic_tools !== undefined) {
          setShowSyntheticTools(data.show_synthetic_tools);
        }
      })
      .catch(() => {});
  }, []);

  const canSeeSyntheticTools = user?.isSuperuser || showSyntheticTools;

  const handleComputeCompleteness = async () => {
    setComputingCompleteness(true);
    try {
      const body = {};
      if (referenceDatasetId) {
        body.reference_dataset_id = parseInt(referenceDatasetId);
      }
      await fetch(`/api/datasets/dataset/${id}/compute-completeness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShowCompletenessDialog(false);
    } catch (e) {
      console.error('Failed to queue completeness computation:', e);
    } finally {
      setComputingCompleteness(false);
    }
  };

  const handleDeleteDataset = async () => {
    setDeletingDataset(true);
    try {
      const res = await fetch(`/api/datasets/dataset/${id}`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        router.push('/datasets');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'Failed to delete dataset');
      }
    } catch (e) {
      console.error('Failed to delete dataset:', e);
      alert('Failed to delete dataset');
    } finally {
      setDeletingDataset(false);
      setShowDeleteDataset(false);
    }
  };

  const handleGenerateSynthetic = async () => {
    setGeneratingSynthetic(true);
    try {
      const selectedStudy = typeof window !== 'undefined' ? localStorage.getItem('selectedStudy') : null;
      const payload = {
        name: syntheticName || `Synthetic from ${dataset?.name}`,
        completeness_bins: syntheticBins,
        images_per_bin: syntheticImagesPerBin,
        use_all_sources: syntheticUseAllSources,
      };
      if (selectedStudy) payload.target_study_id = parseInt(selectedStudy);
      // Only send overrides if any species was customized
      if (Object.keys(profileOverrides).length > 0) {
        payload.profile_overrides = profileOverrides;
      }
      // Include selected augmentations (exclude 'fragments' key)
      const augmentations = {};
      for (const [key, val] of Object.entries(selectedTransformations)) {
        if (key !== 'fragments' && val) augmentations[key] = true;
      }
      if (Object.keys(augmentations).length > 0) {
        payload.augmentations = augmentations;
      }
      const res = await fetch(`/api/datasets/dataset/${id}/generate-synthetic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setShowSyntheticDialog(false);
        setGeneratingSynthetic(false);
        // Navigate to the new synthetic dataset page
        if (data.dataset_id) {
          router.push(`/datasets/${data.dataset_id}`);
          return;
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'Failed to generate synthetic dataset');
      }
    } catch (e) {
      console.error('Failed to queue synthetic generation:', e);
    } finally {
      setGeneratingSynthetic(false);
    }
  };

  const handleRegenerate = async (imageId) => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/datasets/image/${imageId}/regenerate`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        // Update the active image with new data
        setActiveImage(prev => ({ ...prev, ...data, image: data.image + '?v=' + Date.now() }));
        // Refresh the label's image list
        const labelId = activeImage.label;
        const pageNum = page[labelId] || 1;
        const imgRes = await fetch(`/api/datasets/image/?dataset=${id}&label=${labelId}&page=${pageNum}`);
        const imgData = await imgRes.json();
        setImages(prev => ({ ...prev, [labelId]: imgData.results || [] }));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'Failed to regenerate');
      }
    } catch (e) {
      console.error('Failed to regenerate:', e);
      alert('Failed to regenerate image');
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenLabelMenuId(null);
      }
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target)) {
        setShowActionsMenu(false);
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
        isOpen={confirmAction?.type === 'delete-selected' || confirmAction?.type === 'delete-all'}
        title={confirmAction?.type === 'delete-all' ? 'Delete all images in this class?' : 'Delete selected images?'}
        description={confirmAction?.type === 'delete-all'
          ? 'This will remove every image in this class. This cannot be undone.'
          : `This will remove ${confirmAction?.count || 0} selected image(s). This cannot be undone.`}
        confirmLabel={confirmAction?.type === 'delete-all' ? 'Delete all' : 'Delete selected'}
        requireText={confirmAction?.type === 'delete-all' ? confirmAction?.labelName : undefined}
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
                      <div className="relative rounded-lg bg-white ring-1 ring-gray-200 p-3">
                        {activeImage.source_image_data && (
                          <div className="absolute top-2 right-2 z-10 flex gap-1">
                            <button
                              onClick={() => setImageViewMode(imageViewMode === 'original' ? 'transformed' : 'original')}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                imageViewMode === 'original'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              Original
                            </button>
                            <button
                              onClick={() => setImageViewMode(imageViewMode === 'side-by-side' ? 'transformed' : 'side-by-side')}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                imageViewMode === 'side-by-side'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              Side by side
                            </button>
                          </div>
                        )}
                        {imageViewMode === 'side-by-side' && activeImage.source_image_data ? (
                          <div className="grid grid-cols-2 gap-2 pt-8">
                            <div className="rounded-lg bg-white ring-1 ring-gray-200 p-2">
                              <p className="text-[10px] font-medium text-gray-400 mb-1">Original</p>
                              <ArchivedImage
                                src={normalizeMediaUrl(activeImage.source_image_data.image)}
                                alt="Original tooth"
                                width={200}
                                height={200}
                                className="mx-auto max-h-[200px] rounded object-contain"
                              />
                            </div>
                            <div className="rounded-lg bg-white ring-1 ring-gray-200 p-2">
                              <p className="text-[10px] font-medium text-gray-400 mb-1">Transformed</p>
                              <ArchivedImage
                                src={normalizeMediaUrl(activeImage.image)}
                                alt={activeImage.file_name || "dataset image"}
                                width={200}
                                height={200}
                                className="mx-auto max-h-[200px] rounded object-contain"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className={activeImage.source_image_data ? 'pt-8' : ''}>
                            <div className="relative">
                              <ArchivedImage
                                src={normalizeMediaUrl(
                                  imageViewMode === 'original' && activeImage.source_image_data
                                    ? activeImage.source_image_data.image
                                    : activeImage.image
                                )}
                                alt={activeImage.file_name || "dataset image"}
                                width={420}
                                height={420}
                                className="mx-auto max-h-[420px] rounded-lg object-contain transition-opacity duration-300"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      <dl className="space-y-3 text-sm">
                        <div><dt className="font-medium text-gray-500">File name</dt><dd className="text-gray-900 break-all">{activeImage.file_name || activeImage.image?.split('/').pop()}</dd></div>
                        <div><dt className="font-medium text-gray-500">Format</dt><dd className="text-gray-900 uppercase">{activeImage.file_extension || 'Unknown'}</dd></div>
                        <div><dt className="font-medium text-gray-500">Resolution</dt><dd className="text-gray-900">{activeImage.image_width && activeImage.image_height ? `${activeImage.image_width} x ${activeImage.image_height}` : (dataset?.resolution ? `${dataset.resolution} x ${dataset.resolution}` : "Unknown")}</dd></div>
                        {activeImage.file_size ? (<div><dt className="font-medium text-gray-500">Size</dt><dd className="text-gray-900">{formatBytes(activeImage.file_size)}</dd></div>) : null}
                        <div><dt className="font-medium text-gray-500">Label</dt><dd className="text-gray-900">{labels.find((l) => l.id === activeImage.label)?.name || activeImage.label}</dd></div>
                        {canSeeSyntheticTools && activeImage.completeness != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Tooth Completeness</dt>
                            <dd className="text-gray-900">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                activeImage.completeness > 0.8 ? 'bg-green-100 text-green-800' :
                                activeImage.completeness > 0.5 ? 'bg-amber-100 text-amber-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {Math.round(activeImage.completeness * 100)}%
                              </span>
                              {activeImage.tooth_area && <span className="ml-2 text-xs text-gray-400">({activeImage.tooth_area.toLocaleString()} px)</span>}
                            </dd>
                          </div>
                        )}
                        {canSeeSyntheticTools && activeImage.target_completeness != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Target Completeness</dt>
                            <dd className="text-gray-900">{Math.round(activeImage.target_completeness * 100)}%</dd>
                          </div>
                        )}
                        {canSeeSyntheticTools && activeImage.source_image_data?.tooth_area && activeImage.tooth_area && (
                          <div>
                            <dt className="font-medium text-gray-500">Pixel Comparison</dt>
                            <dd className="text-gray-900 text-xs">
                              {activeImage.tooth_area.toLocaleString()} / {activeImage.source_image_data.tooth_area.toLocaleString()} px
                              <span className="ml-1 text-gray-400">
                                ({Math.round((activeImage.tooth_area / activeImage.source_image_data.tooth_area) * 100)}%)
                              </span>
                            </dd>
                          </div>
                        )}
                        <div><dt className="font-medium text-gray-500">Created</dt><dd className="text-gray-900">{new Date(activeImage.created_at).toLocaleString()}</dd></div>
                        {activeImage.source_image_data && (
                          <div className="pt-2">
                            <button
                              onClick={() => handleRegenerate(activeImage.id)}
                              disabled={regenerating}
                              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {regenerating ? 'Regenerating...' : 'Regenerate'}
                            </button>
                          </div>
                        )}
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/datasets')}
                className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                title="Back to datasets"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <h1 className="text-2xl font-bold text-gray-900">{dataset.name}</h1>
            </div>
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
          <div className="relative" ref={actionsMenuRef}>
            <button
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 flex items-center gap-2 transition-colors"
            >
              Actions
              <ChevronDownIcon className="h-4 w-4 text-blue-200" />
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 z-20 mt-2 w-72 origin-top-right rounded-lg bg-white shadow-lg ring-1 ring-gray-900/10 focus:outline-none">
                <div className="py-1">
                  {canSeeSyntheticTools && (
                    <button
                      onClick={() => {
                        setShowActionsMenu(false);
                        if (allDatasets.length === 0) {
                          fetch('/api/datasets/dataset/')
                            .then(r => r.json())
                            .then(data => setAllDatasets(Array.isArray(data) ? data : data.results || []))
                            .catch(console.error);
                        }
                        setReferenceDatasetId('');
                        setShowCompletenessDialog(true);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Compute Completeness
                    </button>
                  )}
                  {canSeeSyntheticTools && !dataset?.for_testing && !dataset?.synthetic && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Transformations</p>
                      <div className="max-h-64 overflow-y-auto px-4 py-1 space-y-1">
                        <label className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-blue-50">
                          <input
                            type="checkbox"
                            checked={selectedTransformations.fragments || false}
                            onChange={() => setSelectedTransformations(prev => ({ ...prev, fragments: !prev.fragments }))}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                          />
                          <span className="text-sm font-medium text-gray-900">Generate Fragments</span>
                        </label>
                        <div className="border-t border-gray-100 my-1" />
                        {AUGMENTATION_FLAGS.map(flag => (
                          <label key={flag.key} className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-blue-50">
                            <input
                              type="checkbox"
                              checked={selectedTransformations[flag.key] || false}
                              onChange={() => setSelectedTransformations(prev => ({ ...prev, [flag.key]: !prev[flag.key] }))}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                            />
                            <span className="text-sm text-gray-700">{flag.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="px-4 py-2">
                        <button
                          onClick={() => {
                            setShowActionsMenu(false);
                            if (selectedTransformations.fragments) {
                              setSyntheticName(`Synthetic from ${dataset?.name}`);
                              setProfileOverrides({});
                              setExpandedSpecies(null);
                              if (!fractureProfiles) {
                                fetch('/api/datasets/dataset/fracture-profiles')
                                  .then(r => r.json())
                                  .then(data => setFractureProfiles(data))
                                  .catch(console.error);
                              }
                              setShowSyntheticDialog(true);
                            }
                          }}
                          disabled={!Object.values(selectedTransformations).some(Boolean)}
                          className={`w-full rounded-md px-3 py-1.5 text-sm font-semibold ${
                            Object.values(selectedTransformations).some(Boolean)
                              ? 'bg-blue-600 text-white hover:bg-blue-500'
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          Apply {Object.values(selectedTransformations).filter(Boolean).length} transformation{Object.values(selectedTransformations).filter(Boolean).length !== 1 ? 's' : ''}
                        </button>
                      </div>
                    </>
                  )}
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowBulkUpload(true);
                    }}
                    disabled={datasetLocked}
                    className={`block w-full px-4 py-2 text-left text-sm ${datasetLocked ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    Bulk Upload
                  </button>
                  {user?.isSuperuser && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          setShowDeleteDataset(true);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete Dataset
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
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
                        onClick={() => { setActiveImage(image); setImageViewMode('transformed'); }}
                      >
                        <ArchivedImage
                          src={normalizeMediaUrl(image.image)}
                          alt={label?.name || 'search result'}
                          width={96}
                          height={96}
                          quality={60}
                          className="h-24 w-24 object-cover rounded-lg ring-1 ring-gray-200 hover:ring-blue-400"
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
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-500"
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
                    <EllipsisVerticalIcon className="h-6 w-6" />
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
                            setConfirmAction({ type: 'delete-all', labelId: label.id, labelName: label.name });
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
                            className={`absolute left-1 top-1 z-10 h-5 w-5 rounded border ${selected.includes(image.id) ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => { setActiveImage(image); setImageViewMode('transformed'); }}
                          className="block"
                          title="View image details"
                        >
                          <ArchivedImage
                            src={normalizeMediaUrl(image.image)}
                            alt={label.name}
                            width={96}
                            height={96}
                            quality={60}
                            className={`h-24 w-24 object-cover rounded-lg ring-1 ${selected.includes(image.id) ? 'ring-blue-600 ring-2' : 'ring-gray-200'} hover:ring-blue-400`}
                          />
                        </button>
                        {canSeeSyntheticTools && image.completeness != null && (
                          <div className={`absolute right-1 top-1 z-10 rounded px-1 py-0.5 text-[10px] font-bold ${
                            image.completeness > 0.8 ? 'bg-green-500/80 text-white' :
                            image.completeness > 0.5 ? 'bg-amber-500/80 text-white' :
                            'bg-red-500/80 text-white'
                          }`}>
                            {Math.round(image.completeness * 100)}%
                          </div>
                        )}
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
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-500"
                  >
                    Load more images...
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compute Completeness Dialog */}
      <Transition.Root show={showCompletenessDialog} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowCompletenessDialog(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Dialog.Panel className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl p-6">
                <Dialog.Title className="text-lg font-semibold text-gray-900">Compute Tooth Completeness</Dialog.Title>
                <p className="mt-1 text-sm text-gray-500">
                  Select a reference dataset of <strong>complete teeth</strong> to compute completeness percentages against.
                  If none selected, uses the current dataset as its own reference.
                </p>
                <div className="mt-4">
                  <label className="text-sm font-medium text-gray-700">Reference Dataset (complete teeth)</label>
                  <select
                    value={referenceDatasetId}
                    onChange={(e) => setReferenceDatasetId(e.target.value)}
                    className={`mt-1 block w-full ${theme.classes.input}`}
                  >
                    <option value="">Same dataset (self-reference)</option>
                    {allDatasets
                      .filter(d => String(d.id) !== String(id))
                      .map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-400">
                    For accurate results, select a base dataset with complete (unfragmented) teeth as the reference.
                  </p>
                </div>
                <div className="mt-5 flex justify-end gap-3">
                  <button
                    onClick={() => setShowCompletenessDialog(false)}
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleComputeCompleteness}
                    disabled={computingCompleteness}
                    className={computingCompleteness ? theme.classes.btnDisabled : theme.classes.btnPrimary}
                  >
                    {computingCompleteness ? 'Queued...' : 'Compute'}
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

      {/* Delete Dataset Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDataset}
        title="Delete this dataset?"
        description={`This will permanently delete "${dataset?.name}" and all its images. This cannot be undone.`}
        confirmLabel={deletingDataset ? 'Deleting...' : 'Delete dataset'}
        requireText={dataset?.name}
        confirmTone="danger"
        onConfirm={handleDeleteDataset}
        onClose={() => setShowDeleteDataset(false)}
      />

      {/* Synthetic Fragment Generation Dialog */}
      <Transition.Root show={showSyntheticDialog} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowSyntheticDialog(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Dialog.Panel className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">Generate Synthetic Fragments</Dialog.Title>
                  <button
                    type="button"
                    onClick={() => setShowParamHelp(!showParamHelp)}
                    className="rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold text-blue-600 bg-blue-100 hover:bg-blue-200"
                    title="Parameter help"
                  >?</button>
                </div>
                <p className="mt-1 text-sm text-gray-500">Create fragmentary tooth images with species-specific fracture patterns.</p>
                {showParamHelp && (
                  <div className="mt-3 rounded-lg bg-blue-50 ring-1 ring-blue-200 p-4 text-xs text-gray-700 space-y-2 max-h-64 overflow-y-auto">
                    <p className="font-semibold text-blue-800 text-sm mb-2">Parameter Reference</p>
                    <p><strong>Completeness Bins</strong>: Target % of tooth remaining. Select multiple to generate at each level.</p>
                    <p><strong>Images per Species per Bin</strong>: Number of fragments per species per bin.</p>
                    <p className="font-semibold text-blue-800 mt-3">Fracture Types (probability weights):</p>
                    <p><strong>root loss</strong>: break at root/base. <strong>tip loss</strong>: break at crown apex. <strong>lateral break</strong>: diagonal cut removing one side.</p>
                    <p><strong>edge chip</strong>: small serration chip. <strong>diagonal snap</strong>: 25-55 degree oblique cut. <strong>transverse snap</strong>: near-vertical break with wide dentine.</p>
                    <p><strong>oblique front</strong>: steep 55-80 degree cut on the labial face. Weights are relative, do not need to sum to 1.</p>
                    <p className="font-semibold text-blue-800 mt-3">Edge Parameters:</p>
                    <p><strong>Roughness</strong>: Irregularity of fracture line (0=smooth, 1=very jagged).</p>
                    <p><strong>Micro roughness</strong>: Fine pixel-level surface detail.</p>
                    <p><strong>Curvature</strong>: How much the fracture follows the tooth contour (0=straight, 1=follows shape).</p>
                    <p><strong>3D edge (px)</strong>: Base width of exposed dentine in pixels (multiplied by fracture type: transverse 2.5x, oblique 2x, lateral 1.5x).</p>
                    <p className="font-semibold text-blue-800 mt-3">Dentine Color:</p>
                    <p><strong>Auto-match</strong>: Samples the darkest 30% of the tooth and lightens by Clarity %. Matches each tooth color automatically.</p>
                    <p><strong>Manual range</strong>: Pick min/max colors; random color per fragment within that range.</p>
                    <p><strong>Clarity boost %</strong>: Lightening from dark sample (0=same as dark, 100=white).</p>
                  </div>
                )}

                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Dataset Name</label>
                    <input
                      type="text"
                      value={syntheticName}
                      onChange={(e) => setSyntheticName(e.target.value)}
                      className={`mt-1 block w-full ${theme.classes.input}`}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700">Completeness Bins (%)</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[90, 80, 70, 60, 50, 40, 30, 20].map(pct => {
                        const val = pct / 100;
                        const active = syntheticBins.includes(val);
                        return (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setSyntheticBins(prev =>
                              active ? prev.filter(b => b !== val) : [...prev, val].sort((a, b) => b - a)
                            )}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                              active ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-600/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {pct}%
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700">Images per Species per Bin</label>
                    <div className="mt-1 flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={syntheticImagesPerBin}
                        onChange={(e) => setSyntheticImagesPerBin(Math.max(1, parseInt(e.target.value) || 1))}
                        disabled={syntheticUseAllSources}
                        className={`block w-24 ${theme.classes.input} ${syntheticUseAllSources ? 'opacity-50 cursor-not-allowed' : ''}`}
                      />
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={syntheticUseAllSources}
                          onChange={(e) => setSyntheticUseAllSources(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Max (use all source images per class)</span>
                      </label>
                    </div>
                    {syntheticUseAllSources && (
                      <p className="mt-1 text-xs text-gray-500">
                        Each source image is used once per bin. Classes with fewer images produce fewer fragments — output follows source class balance.
                      </p>
                    )}
                  </div>

                  {/* Per-species fracture profiles */}
                  {fractureProfiles && labels.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Fracture Profiles by Species</label>
                      <p className="text-xs text-gray-400 mt-0.5">Click a species to customize fracture type probabilities and edge roughness.</p>
                      <div className="mt-2 space-y-1">
                        {labels.map(label => {
                          const speciesName = label.name;
                          const isExpanded = expandedSpecies === speciesName;
                          const defaultProfile = fractureProfiles[speciesName] || fractureProfiles['default'] || {};
                          const override = profileOverrides[speciesName] || {};
                          const fracTypes = override.fracture_types || defaultProfile.fracture_types || {};
                          const edgeParams = override.edge_params || defaultProfile.edge_params || {};
                          const isCustomized = !!profileOverrides[speciesName];

                          const updateOverride = (section, key, value) => {
                            setProfileOverrides(prev => {
                              const current = prev[speciesName] || {};
                              const currentSection = current[section] || { ...(defaultProfile[section] || {}) };
                              return {
                                ...prev,
                                [speciesName]: {
                                  ...current,
                                  [section]: { ...currentSection, [key]: value },
                                },
                              };
                            });
                          };

                          const resetSpecies = () => {
                            setProfileOverrides(prev => {
                              const next = { ...prev };
                              delete next[speciesName];
                              return next;
                            });
                          };

                          return (
                            <div key={speciesName} className="border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setExpandedSpecies(isExpanded ? null : speciesName)}
                                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                              >
                                <span className="font-medium text-gray-800">
                                  {speciesName}
                                  {isCustomized && <span className="ml-2 text-xs text-blue-600">(customized)</span>}
                                </span>
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50">
                                  <div className="mt-2">
                                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Fracture Types (probability weights)</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                      {['root_loss', 'tip_loss', 'lateral_break', 'edge_chip', 'diagonal_snap', 'transverse_snap', 'oblique_front'].map(type => (
                                        <div key={type} className="flex items-center gap-2">
                                          <label className="text-xs text-gray-600 w-24 truncate" title={type}>{type.replace('_', ' ')}</label>
                                          <input
                                            type="number"
                                            step="0.05"
                                            min="0"
                                            max="1"
                                            value={fracTypes[type] ?? 0}
                                            onChange={(e) => updateOverride('fracture_types', type, parseFloat(e.target.value) || 0)}
                                            className="w-16 text-xs rounded border-gray-300 px-1.5 py-0.5"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="mt-3">
                                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Edge Parameters</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                      {[
                                        { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.1 },
                                        { key: 'micro_roughness', label: 'Micro roughness', min: 0, max: 1, step: 0.1 },
                                        { key: 'curvature', label: 'Curvature', min: 0, max: 1, step: 0.1 },
                                        { key: 'edge_3d_width', label: '3D edge (px)', min: 0, max: 10, step: 1 },
                                      ].map(param => (
                                        <div key={param.key} className="flex items-center gap-2">
                                          <label className="text-xs text-gray-600 w-24 truncate" title={param.label}>{param.label}</label>
                                          <input
                                            type="number"
                                            step={param.step}
                                            min={param.min}
                                            max={param.max}
                                            value={edgeParams[param.key] ?? 0}
                                            onChange={(e) => updateOverride('edge_params', param.key, parseFloat(e.target.value) || 0)}
                                            className="w-16 text-xs rounded border-gray-300 px-1.5 py-0.5"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="mt-3">
                                    <p className="text-xs font-semibold text-gray-600 mb-1.5">Dentine Color</p>
                                    <div className="flex items-center gap-3 mb-2">
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`dentine_mode_${speciesName}`}
                                          checked={(edgeParams.dentine_color_mode || 'auto') === 'auto'}
                                          onChange={() => updateOverride('edge_params', 'dentine_color_mode', 'auto')}
                                          className="text-blue-600 focus:ring-blue-600"
                                        />
                                        <span className="text-xs text-gray-600">Auto-match tooth</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`dentine_mode_${speciesName}`}
                                          checked={edgeParams.dentine_color_mode === 'manual'}
                                          onChange={() => updateOverride('edge_params', 'dentine_color_mode', 'manual')}
                                          className="text-blue-600 focus:ring-blue-600"
                                        />
                                        <span className="text-xs text-gray-600">Manual range</span>
                                      </label>
                                    </div>
                                    {(edgeParams.dentine_color_mode || 'auto') === 'auto' ? (
                                      <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-600 w-24">Clarity boost %</label>
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          step="5"
                                          value={edgeParams.dentine_clarity_pct ?? 15}
                                          onChange={(e) => updateOverride('edge_params', 'dentine_clarity_pct', parseInt(e.target.value) || 0)}
                                          className="w-16 text-xs rounded border-gray-300 px-1.5 py-0.5"
                                        />
                                      </div>
                                    ) : (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-600 w-16">Min color</label>
                                          <input
                                            type="color"
                                            value={(() => {
                                              const c = edgeParams.dentine_color_min || [140, 130, 110];
                                              return `#${c.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('')}`;
                                            })()}
                                            onChange={(e) => {
                                              const hex = e.target.value;
                                              const rgb = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
                                              updateOverride('edge_params', 'dentine_color_min', rgb);
                                            }}
                                            className="w-8 h-6 rounded border border-gray-300 cursor-pointer"
                                          />
                                          <span className="text-[10px] text-gray-400">
                                            {(edgeParams.dentine_color_min || [140,130,110]).join(', ')}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs text-gray-600 w-16">Max color</label>
                                          <input
                                            type="color"
                                            value={(() => {
                                              const c = edgeParams.dentine_color_max || [200, 190, 170];
                                              return `#${c.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('')}`;
                                            })()}
                                            onChange={(e) => {
                                              const hex = e.target.value;
                                              const rgb = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
                                              updateOverride('edge_params', 'dentine_color_max', rgb);
                                            }}
                                            className="w-8 h-6 rounded border border-gray-300 cursor-pointer"
                                          />
                                          <span className="text-[10px] text-gray-400">
                                            {(edgeParams.dentine_color_max || [200,190,170]).join(', ')}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  {isCustomized && (
                                    <button
                                      type="button"
                                      onClick={resetSpecies}
                                      className="mt-2 text-xs text-blue-600 hover:text-blue-500"
                                    >
                                      Reset to defaults
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                    {syntheticUseAllSources ? (() => {
                      const totalSources = labels.reduce((sum, l) => sum + (l.image_count || 0), 0);
                      return (
                        <>
                          Estimated output: ~{syntheticBins.length * totalSources} images
                          ({syntheticBins.length} bins x {totalSources} source images across {labels.length} species)
                        </>
                      );
                    })() : (
                      <>
                        Estimated output: ~{syntheticBins.length * syntheticImagesPerBin * labels.length} images
                        ({syntheticBins.length} bins x {syntheticImagesPerBin} images x {labels.length} species)
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    onClick={() => setShowSyntheticDialog(false)}
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateSynthetic}
                    disabled={generatingSynthetic || syntheticBins.length === 0}
                    className={generatingSynthetic || syntheticBins.length === 0 ? theme.classes.btnDisabled : theme.classes.btnPrimary}
                  >
                    {generatingSynthetic ? 'Queuing...' : 'Generate'}
                  </button>
                </div>
              </Dialog.Panel>
            </div>
          </div>
        </Dialog>
      </Transition.Root>
    </Layout>
  );
}
