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
import ReviewInspector from '../../components/ReviewInspector';
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
  InformationCircleIcon,
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
  const [inspectorImage, setInspectorImage] = useState(null);
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
  const [syntheticStudies, setSyntheticStudies] = useState([]);
  const [syntheticTargetStudy, setSyntheticTargetStudy] = useState('');
  const [fractureProfiles, setFractureProfiles] = useState(null);
  const [profileOverrides, setProfileOverrides] = useState({});
  const [expandedSpecies, setExpandedSpecies] = useState(null);
  const [showDeleteDataset, setShowDeleteDataset] = useState(false);
  const [deletingDataset, setDeletingDataset] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showParamHelp, setShowParamHelp] = useState(false);
  const [completenessMetric, setCompletenessMetric] = useState('px');
  const [emittingProcessed, setEmittingProcessed] = useState(false);
  const [buildingBrokennessRef, setBuildingBrokennessRef] = useState(false);
  const [computingBrokenness, setComputingBrokenness] = useState(false);
  const [showEmitModeBDialog, setShowEmitModeBDialog] = useState(false);
  const [emitModeBPxPerMm, setEmitModeBPxPerMm] = useState(6.0);
  const [runningOcr, setRunningOcr] = useState(false);
  const [showRunOcrConfirm, setShowRunOcrConfirm] = useState(false);
  const [showEmitModeAConfirm, setShowEmitModeAConfirm] = useState(false);
  const [actionStatus, setActionStatus] = useState(null);
  const [reviewSummary, setReviewSummary] = useState(null);
  const [scaleSummary, setScaleSummary] = useState(null);
  // Tab lives in the URL so a teammate can be sent straight to a section
  // (…/datasets/168?tab=images) instead of "open it and click the tab".
  //
  // Summary opens first: the useful question on arriving at a dataset is what
  // state it is in, not what the first thumbnail looks like. A ?tab= in the
  // URL still wins, so existing links keep working.
  const [activeTab, setActiveTab] = useState('summary');
  const [selectedTransformations, setSelectedTransformations] = useState({ fragments: false });
  const [imageViewMode, setImageViewMode] = useState('transformed'); // 'transformed', 'original', 'side-by-side'
  const [regenerating, setRegenerating] = useState(false);

  const fileInputRefs = useRef({});
  const menuRef = useRef(null);
  const actionsMenuRef = useRef(null);

  const router = useRouter();
  const { id } = router.query;

  // Adopt ?tab= on first load so a shared link opens on the right section.
  useEffect(() => {
    const t = router.query.tab;
    if (t === 'summary' || t === 'images') setActiveTab(t);
  }, [router.query.tab]);
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
      const [datasetData, labelsData, reviewData, scaleData] = await Promise.all([
        fetch(`/api/datasets/dataset/${id}`).then((res) => res.json()),
        fetch(`/api/datasets/label/?datasets__id=${id}`).then((res) => res.json()),
        // counts_only: this page reads the totals and the pipeline stats, never
        // the per-image lists. Without it the response is ~4.5 MB of image JSON
        // that the browser parses and discards.
        fetch(`/api/datasets/dataset/${id}/review-queue?counts_only=1`).then((res) => res.ok ? res.json() : null).catch(() => null),
        fetch(`/api/datasets/dataset/${id}/scale-summary`).then((res) => res.ok ? res.json() : null).catch(() => null),
      ]);

      setDataset(datasetData);
      setLabels(labelsData);
      if (reviewData) setReviewSummary(reviewData);
      if (scaleData) setScaleSummary(scaleData);

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
  // URL lands the recipient in the correct study context. On first visit (no
  // prior selectedStudy) we just write localStorage and let the Layout pick
  // it up — reloading mid-load throws away in-flight image fetches and the
  // page renders empty until the user reloads again. We only force a reload
  // when the user *had* a different study selected and we want the navbar
  // dropdown to reflect the dataset's study immediately.
  useEffect(() => {
    if (!user || !dataset?.study) return;
    if (typeof window === 'undefined') return;
    const datasetStudy = String(dataset.study);
    const current = localStorage.getItem(`selectedStudy_${user.id}`)
      || localStorage.getItem('selectedStudy');
    if (current === datasetStudy) return;
    localStorage.setItem(`selectedStudy_${user.id}`, datasetStudy);
    localStorage.setItem('selectedStudy', datasetStudy);
    if (current) {
      // User had a different study selected — reload so the navbar updates.
      window.location.reload();
    }
    // First visit (current was empty/null): no reload. Layout's own effect
    // will pick up the freshly-written value on its next mount.
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
      const endpoint = completenessMetric === 'mm2'
        ? `/api/datasets/dataset/${id}/compute-completeness-mm2`
        : `/api/datasets/dataset/${id}/compute-completeness`;
      await fetch(endpoint, {
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

  const showStatus = (tone, message) => {
    setActionStatus({ tone, message });
    // Auto-dismiss after ~8 seconds so the banner doesn't linger.
    setTimeout(() => {
      setActionStatus((current) => (current && current.message === message ? null : current));
    }, 8000);
  };

  const handleRunOcr = async () => {
    setRunningOcr(true);
    setShowRunOcrConfirm(false);
    try {
      const res = await fetch(`/api/datasets/dataset/${id}/extract-museum-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        showStatus('success', 'Queued FLMNH label OCR. Museum metadata fields will populate on each image as the task progresses.');
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || 'Failed to queue OCR');
      }
    } catch (e) {
      console.error('Failed to queue OCR:', e);
      showStatus('error', 'Failed to queue OCR');
    } finally {
      setRunningOcr(false);
    }
  };

  const handleEmitProcessed = async (mode, modeBPxPerMm = 6.0) => {
    setEmittingProcessed(true);
    try {
      const body = { mode };
      if (mode === 'B') {
        body.mode_b_px_per_mm = parseFloat(modeBPxPerMm) || 6.0;
      }
      const res = await fetch(`/api/datasets/dataset/${id}/emit-processed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showStatus('success', `Queued Processed Mode ${mode}. A new derived dataset will appear in the Datasets list when the task finishes.`);
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || `Failed to queue Processed Mode ${mode}`);
      }
    } catch (e) {
      console.error('Failed to queue emit_processed:', e);
      showStatus('error', 'Failed to queue emit_processed');
    } finally {
      setEmittingProcessed(false);
      setShowEmitModeBDialog(false);
      setShowEmitModeAConfirm(false);
    }
  };

  const handleBuildBrokennessReference = async () => {
    setBuildingBrokennessRef(true);
    try {
      const res = await fetch(`/api/datasets/dataset/${id}/build-brokenness-reference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        showStatus('success', "Queued Kathie's mean-mask reference build. Per-species artifacts will land under mediafiles/brokenness_reference/ when done.");
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || 'Failed to queue brokenness reference build');
      }
    } catch (e) {
      console.error('Failed to queue brokenness reference build:', e);
      showStatus('error', 'Failed to queue brokenness reference build');
    } finally {
      setBuildingBrokennessRef(false);
    }
  };

  const handleComputeBrokenness = async () => {
    setComputingBrokenness(true);
    try {
      const body = {};
      if (referenceDatasetId) {
        body.reference_dataset_id = parseInt(referenceDatasetId);
      }
      const res = await fetch(`/api/datasets/dataset/${id}/compute-brokenness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showStatus('success', "Queued Kathie's brokenness pass. percent_broken and the overlay will populate on each image as the task progresses.");
      } else {
        const data = await res.json().catch(() => ({}));
        showStatus('error', data.message || data.error || 'Failed to queue brokenness pass');
      }
    } catch (e) {
      console.error('Failed to queue brokenness pass:', e);
      showStatus('error', 'Failed to queue brokenness pass');
    } finally {
      setComputingBrokenness(false);
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
      const payload = {
        name: syntheticName || `Synthetic from ${dataset?.name}`,
        completeness_bins: syntheticBins,
        images_per_bin: syntheticImagesPerBin,
        use_all_sources: syntheticUseAllSources,
      };
      // Honour the target-study picker; empty string falls back to the
      // backend default (source dataset's study).
      if (syntheticTargetStudy) {
        payload.target_study_id = parseInt(syntheticTargetStudy);
      }
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

  // Stepping through teeth from the inspector: the same order as the grid,
  // species by species, over the images loaded so far.
  const inspectorList = labels.flatMap((label) => images[label.id] || []);
  const inspectorIndex = inspectorImage ? inspectorList.findIndex((item) => item.id === inspectorImage.id) : -1;
  const stepInspector = (offset) => {
    const next = inspectorList[inspectorIndex + offset];
    if (next) { setInspectorImage(next); setActiveImage(next); }
  };

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
                        {activeImage.completeness != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Tooth Completeness (px)</dt>
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
                        {activeImage.completeness_mm2 != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Tooth Completeness (mm&sup2;)</dt>
                            <dd className="text-gray-900">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                activeImage.completeness_mm2 > 0.8 ? 'bg-green-50 text-green-800 ring-green-300' :
                                activeImage.completeness_mm2 > 0.5 ? 'bg-amber-50 text-amber-800 ring-amber-300' :
                                'bg-red-50 text-red-800 ring-red-300'
                              }`}>
                                {Math.round(activeImage.completeness_mm2 * 100)}% mm&sup2;
                              </span>
                              {activeImage.tooth_area_mm2 != null && (
                                <span className="ml-2 text-xs text-gray-400">({activeImage.tooth_area_mm2.toFixed(1)} mm&sup2;)</span>
                              )}
                            </dd>
                          </div>
                        )}
                        {activeImage.percent_broken != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Brokenness (Kathie&apos;s method, chained)</dt>
                            <dd className="text-gray-900">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                activeImage.percent_broken < 20 ? 'bg-green-50 text-green-800 ring-green-300' :
                                activeImage.percent_broken < 50 ? 'bg-amber-50 text-amber-800 ring-amber-300' :
                                'bg-red-50 text-red-800 ring-red-300'
                              }`}>
                                {activeImage.percent_broken.toFixed(1)}% broken
                              </span>
                              <span className="ml-2 text-xs text-gray-400">combined</span>
                              {activeImage.brokenness_meta && (
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
                                  {activeImage.brokenness_meta.shape_pct_broken != null && (
                                    <>
                                      <span className="text-gray-400">shape (alignment):</span>
                                      <span className="font-medium">{activeImage.brokenness_meta.shape_pct_broken.toFixed(1)}%</span>
                                    </>
                                  )}
                                  {activeImage.brokenness_meta.size_pct_broken != null && (
                                    <>
                                      <span className="text-gray-400">size (mm&sup2; ratio):</span>
                                      <span className="font-medium">{activeImage.brokenness_meta.size_pct_broken.toFixed(1)}%</span>
                                    </>
                                  )}
                                  {activeImage.brokenness_meta.quantile != null && (
                                    <>
                                      <span className="text-gray-400">aspect quantile:</span>
                                      <span className="font-medium">Q{activeImage.brokenness_meta.quantile}</span>
                                    </>
                                  )}
                                  {activeImage.brokenness_meta.iou_score != null && (
                                    <>
                                      <span className="text-gray-400">alignment IoU:</span>
                                      <span className="font-medium">{activeImage.brokenness_meta.iou_score.toFixed(2)}</span>
                                    </>
                                  )}
                                  {activeImage.brokenness_meta.applied_canonical_rotation_deg != null && (
                                    <>
                                      <span className="text-gray-400">pre-rotation:</span>
                                      <span className="font-medium">{activeImage.brokenness_meta.applied_canonical_rotation_deg.toFixed(1)}&deg;</span>
                                    </>
                                  )}
                                </div>
                              )}
                              {activeImage.brokenness_overlay_url && (
                                <div className="mt-1.5">
                                  <img
                                    src={activeImage.brokenness_overlay_url}
                                    alt="mean-shape brokenness overlay"
                                    className="rounded ring-1 ring-gray-200"
                                    style={{ width: 128, height: 128 }}
                                  />
                                  <div className="text-[10px] text-gray-400 mt-0.5">gray = mean shape &middot; green = tooth present</div>
                                </div>
                              )}
                            </dd>
                          </div>
                        )}
                        {activeImage.mm_per_pixel != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Scale Calibration</dt>
                            <dd className="text-gray-900 text-xs">
                              {activeImage.mm_per_pixel.toFixed(5)} mm/px
                              {activeImage.scale_bar_detected === false && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">bar not detected</span>
                              )}
                            </dd>
                          </div>
                        )}
                        {(activeImage.tooth_major_axis_mm != null
                          || activeImage.tooth_minor_axis_mm != null
                          || activeImage.tooth_area_mm2 != null) && (
                          <div>
                            <dt className="font-medium text-gray-500">Tooth Dimensions</dt>
                            <dd className="text-gray-900 text-xs space-y-0.5">
                              {activeImage.tooth_major_axis_mm != null && (
                                <div><span className="text-gray-500">Length:</span> <span className="font-medium">{activeImage.tooth_major_axis_mm.toFixed(1)} mm</span></div>
                              )}
                              {activeImage.tooth_minor_axis_mm != null && (
                                <div><span className="text-gray-500">Width:</span>  <span className="font-medium">{activeImage.tooth_minor_axis_mm.toFixed(1)} mm</span></div>
                              )}
                              {activeImage.tooth_area_mm2 != null && (
                                <div><span className="text-gray-500">Area:</span>   <span className="font-medium">{activeImage.tooth_area_mm2.toFixed(1)} mm&sup2;</span></div>
                              )}
                            </dd>
                          </div>
                        )}
                        {(activeImage.museum_specimen_id
                          || activeImage.museum_species
                          || activeImage.museum_completeness_category
                          || activeImage.museum_metadata) && (
                          <div>
                            <dt className="font-medium text-gray-500">Museum Metadata (OCR)</dt>
                            <dd className="text-gray-900 text-xs space-y-1">
                              {activeImage.museum_specimen_id && (
                                <div><span className="text-gray-500">Specimen ID:</span> <span className="font-medium">{activeImage.museum_specimen_id}</span></div>
                              )}
                              {activeImage.museum_species && (
                                <div><span className="text-gray-500">Species (OCR):</span> <em>{activeImage.museum_species}</em></div>
                              )}
                              {activeImage.museum_completeness_category && (
                                <div><span className="text-gray-500">Museum category:</span> {activeImage.museum_completeness_category}</div>
                              )}
                              {activeImage.museum_metadata?.locality && (
                                <div><span className="text-gray-500">Locality:</span> {activeImage.museum_metadata.locality}</div>
                              )}
                              {activeImage.museum_metadata?.formation && (
                                <div><span className="text-gray-500">Formation:</span> {activeImage.museum_metadata.formation}</div>
                              )}
                              {activeImage.museum_metadata?.age && (
                                <div><span className="text-gray-500">Age:</span> {activeImage.museum_metadata.age}</div>
                              )}
                              {activeImage.museum_metadata?.collector && (
                                <div><span className="text-gray-500">Collector:</span> {activeImage.museum_metadata.collector}</div>
                              )}
                              {activeImage.museum_metadata?.date && (
                                <div><span className="text-gray-500">Date:</span> {activeImage.museum_metadata.date}</div>
                              )}
                              {activeImage.museum_metadata?.confidence != null && (
                                <div className="pt-1 text-gray-400">OCR confidence: {Math.round(activeImage.museum_metadata.confidence * 100)}%</div>
                              )}
                            </dd>
                          </div>
                        )}
                        {canSeeSyntheticTools && (
                          <ReviewStatusBlock
                            image={activeImage}
                            onInspect={() => setInspectorImage(activeImage)}
                            onChanged={async (updated) => {
                              setActiveImage(prev => ({ ...prev, ...updated }));
                              // refetch the dataset-level review summary so the menu badge updates
                              try {
                                const r = await fetch(`/api/datasets/dataset/${id}/review-queue?counts_only=1`);
                                if (r.ok) setReviewSummary(await r.json());
                              } catch {}
                            }}
                          />
                        )}
                        {activeImage.target_completeness != null && (
                          <div>
                            <dt className="font-medium text-gray-500">Target Completeness</dt>
                            <dd className="text-gray-900">{Math.round(activeImage.target_completeness * 100)}%</dd>
                          </div>
                        )}
                        {activeImage.source_image_data?.tooth_area && activeImage.tooth_area && (
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
                        {activeImage.source_image_data?.tooth_area_mm2 != null && activeImage.tooth_area_mm2 != null && (
                          <div>
                            <dt className="font-medium text-gray-500">mm&sup2; Comparison</dt>
                            <dd className="text-gray-900 text-xs">
                              {activeImage.tooth_area_mm2.toFixed(1)} / {activeImage.source_image_data.tooth_area_mm2.toFixed(1)} mm&sup2;
                              <span className="ml-1 text-gray-400">
                                ({Math.round((activeImage.tooth_area_mm2 / activeImage.source_image_data.tooth_area_mm2) * 100)}%)
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

      {actionStatus && (
        <div
          className={`fixed top-4 right-4 z-40 max-w-md rounded-lg shadow-lg ring-1 ring-black/5 px-4 py-3 text-sm transition-opacity ${
            actionStatus.tone === 'success'
              ? 'bg-green-50 text-green-900 ring-green-200'
              : actionStatus.tone === 'error'
                ? 'bg-red-50 text-red-900 ring-red-200'
                : 'bg-blue-50 text-blue-900 ring-blue-200'
          }`}
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{actionStatus.message}</span>
            <button
              onClick={() => setActionStatus(null)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

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
                        setCompletenessMetric('px');
                        setShowCompletenessDialog(true);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Compute Completeness (px)
                    </button>
                  )}
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
                        setCompletenessMetric('mm2');
                        setShowCompletenessDialog(true);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Compute Completeness (mm&sup2;)
                    </button>
                  )}
                  {canSeeSyntheticTools && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          setShowRunOcrConfirm(true);
                        }}
                        disabled={runningOcr}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Run FLMNH Label OCR
                      </button>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          router.push(`/datasets/${id}/review`);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-between"
                      >
                        <span>Review Queue</span>
                        {reviewSummary && reviewSummary.total_flagged > 0 && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            {reviewSummary.total_flagged} to review
                          </span>
                        )}
                      </button>
                    </>
                  )}
                  {canSeeSyntheticTools && !dataset?.synthetic && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">Emit Processed</p>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          setShowEmitModeAConfirm(true);
                        }}
                        disabled={emittingProcessed}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Emit Processed Mode A (uniform)
                      </button>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          setEmitModeBPxPerMm(6.0);
                          setShowEmitModeBDialog(true);
                        }}
                        disabled={emittingProcessed}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Emit Processed Mode B (scale-preserving)
                      </button>
                    </>
                  )}
                  {canSeeSyntheticTools && (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <p className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        Brokenness (Kathie&apos;s method)
                      </p>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          handleBuildBrokennessReference();
                        }}
                        disabled={buildingBrokennessRef}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Build mean-mask reference
                      </button>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          handleComputeBrokenness();
                        }}
                        disabled={computingBrokenness}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Compute percent broken
                      </button>
                    </>
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
                              // Default the target study to whatever is currently selected
                              // in the navbar; user can override in the dialog before submit.
                              const currentStudy = typeof window !== 'undefined'
                                ? localStorage.getItem('selectedStudy') || ''
                                : '';
                              setSyntheticTargetStudy(currentStudy);
                              fetch('/api/feature_extractor/studies/')
                                .then(r => r.json())
                                .then(data => {
                                  const list = Array.isArray(data) ? data : data.results || [];
                                  setSyntheticStudies(list);
                                })
                                .catch(console.error);
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
            <dd className="mt-1 text-sm text-gray-900">
              {dataset.resolution === 'original' ? 'Original (no resize)' : `${dataset.resolution}px`}
            </dd>
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

      {dataset?.resolution === 'original' && reviewSummary && (
        <PipelinePanel
          dataset={dataset}
          stats={reviewSummary.pipeline_stats}
          reviewCounts={reviewSummary.review_status_counts}
          flaggedCount={reviewSummary.total_flagged}
          problemCount={reviewSummary.total_problems ?? 0}
          pendingReviewCount={reviewSummary.total_pending_review ?? 0}
          onRunOcr={() => setShowRunOcrConfirm(true)}
          onComputeMm2={() => {
            if (allDatasets.length === 0) {
              fetch('/api/datasets/dataset/')
                .then(r => r.json())
                .then(data => setAllDatasets(Array.isArray(data) ? data : data.results || []))
                .catch(console.error);
            }
            setReferenceDatasetId('');
            setCompletenessMetric('mm2');
            setShowCompletenessDialog(true);
          }}
          onOpenReview={() => router.push(`/datasets/${id}/review`)}
          onEmitModeA={() => setShowEmitModeAConfirm(true)}
          onEmitModeB={() => { setEmitModeBPxPerMm(6.0); setShowEmitModeBDialog(true); }}
        />
      )}

      {scaleSummary && (
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-6" aria-label="Dataset sections">
            {[
              { key: 'summary', label: 'Summary', badge: scaleSummary.totals?.uncalibrated || 0 },
              { key: 'images', label: 'Images' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setActiveTab(t.key);
                  router.replace(
                    { pathname: router.pathname, query: { ...router.query, tab: t.key } },
                    undefined,
                    { shallow: true },
                  );
                }}
                className={`whitespace-nowrap border-b-2 py-3 px-1 text-sm font-medium ${
                  activeTab === t.key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {t.label}
                {t.badge > 0 && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      )}

      {activeTab === 'summary' && scaleSummary && (
        <ScaleSummaryPanel
          summary={scaleSummary}
          datasetId={id}
          onOpenReview={() => router.push(`/datasets/${id}/review`)}
        />
      )}

      {/* Hide the image list only when the summary is actually on screen.
          Summary is the default tab, but it renders nothing until its fetch
          lands and it does not exist at all for datasets without a scale
          summary, so keying purely off activeTab would leave those pages
          blank. */}
      <div className={activeTab === 'summary' && scaleSummary ? 'hidden' : ''}>
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
                        {(image.completeness != null || image.completeness_mm2 != null) && (
                          <div className="absolute right-1 top-1 z-10 flex flex-col items-end gap-0.5">
                            {image.completeness != null && (
                              <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                                image.completeness > 0.8 ? 'bg-green-500/80 text-white' :
                                image.completeness > 0.5 ? 'bg-amber-500/80 text-white' :
                                'bg-red-500/80 text-white'
                              }`}>
                                {Math.round(image.completeness * 100)}%
                              </span>
                            )}
                            {image.completeness_mm2 != null && (
                              <span className={`rounded px-1 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                                image.completeness_mm2 > 0.8 ? 'bg-green-50/95 text-green-800 ring-green-400' :
                                image.completeness_mm2 > 0.5 ? 'bg-amber-50/95 text-amber-800 ring-amber-400' :
                                'bg-red-50/95 text-red-800 ring-red-400'
                              }`} title="Completeness in mm²">
                                {Math.round(image.completeness_mm2 * 100)}% mm&sup2;
                              </span>
                            )}
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
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Compute Tooth Completeness {completenessMetric === 'mm2' ? '(mm²)' : '(px)'}
                </Dialog.Title>
                <p className="mt-1 text-sm text-gray-500">
                  Select a reference dataset of <strong>complete teeth</strong> to compute completeness percentages against.
                  If none selected, uses the current dataset as its own reference.
                  {completenessMetric === 'mm2' && (
                    <span className="block mt-2 text-xs text-amber-700">
                      mm&sup2; mode requires scale bars in the photos. Images without a detectable bar will be skipped.
                    </span>
                  )}
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

      {/* Run FLMNH Label OCR confirmation */}
      <ConfirmDialog
        isOpen={showRunOcrConfirm}
        onClose={() => setShowRunOcrConfirm(false)}
        onConfirm={() => handleRunOcr()}
        title="Run FLMNH Label OCR?"
        description={`This runs Tesseract OCR on every image in "${dataset?.name}" and parses the printed catalog label into museum_specimen_id, species, completeness category, locality, formation, age, collector, and date. Best on Raw images that still show the label. Masked images and images without a label blob are skipped quietly.`}
        confirmLabel={runningOcr ? 'Queueing...' : 'Run OCR'}
        confirmTone="primary"
      />

      {/* Emit Processed Mode A confirmation */}
      <ConfirmDialog
        isOpen={showEmitModeAConfirm}
        onClose={() => setShowEmitModeAConfirm(false)}
        onConfirm={() => handleEmitProcessed('A')}
        title="Emit Processed Mode A?"
        description={`Produces a new derived dataset of 384x384 PNGs from "${dataset?.name}". Mode A is the Phase I uniform-pixel-density layout: each tooth is rescaled to fill the canvas, the scale bar is cropped out. Absolute physical size is NOT preserved in the output.`}
        confirmLabel={emittingProcessed ? 'Queueing...' : 'Emit Mode A'}
        confirmTone="primary"
      />

      {/* Emit Processed Mode B dialog */}
      <Transition.Root show={showEmitModeBDialog} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setShowEmitModeBDialog(false)}>
          <Transition.Child as={Fragment} enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
          </Transition.Child>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Dialog.Panel className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl p-6">
                <Dialog.Title className="text-lg font-semibold text-gray-900">
                  Emit Processed Mode B (scale-preserving)
                </Dialog.Title>
                <p className="mt-1 text-sm text-gray-500">
                  Mode B keeps 1 mm equal to the same number of output pixels in every image, regardless of the source photo&apos;s zoom level. Small teeth occupy a proportionally smaller fraction of the canvas. The source dataset must already be calibrated (mm/px populated on every image).
                </p>
                <div className="mt-4">
                  <label className="text-sm font-medium text-gray-700">Pixels per millimetre</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={emitModeBPxPerMm}
                    onChange={(e) => setEmitModeBPxPerMm(e.target.value)}
                    className={`mt-1 block w-full ${theme.classes.input}`}
                  />
                  <p className="mt-2 text-xs text-gray-400">
                    Default 6.0 fits a ~64 mm tooth in a 384 px canvas. Lower values give more padding for small teeth; higher values give more detail but risk clipping large ones.
                  </p>
                </div>
                <div className="mt-5 flex justify-end gap-3">
                  <button
                    onClick={() => setShowEmitModeBDialog(false)}
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleEmitProcessed('B', emitModeBPxPerMm)}
                    disabled={emittingProcessed}
                    className={emittingProcessed ? theme.classes.btnDisabled : theme.classes.btnPrimary}
                  >
                    {emittingProcessed ? 'Queued...' : 'Emit Mode B'}
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
                    <label className="text-sm font-medium text-gray-700">Target Study</label>
                    <select
                      value={syntheticTargetStudy}
                      onChange={(e) => setSyntheticTargetStudy(e.target.value)}
                      className={`mt-1 block w-full ${theme.classes.select}`}
                    >
                      <option value="">— Source dataset&apos;s study —</option>
                      {syntheticStudies.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      The new synthetic dataset will be created in this study. Defaults to the study currently selected in the navbar.
                    </p>
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

      <ReviewInspector
        img={inspectorImage}
        position={inspectorIndex + 1}
        total={inspectorList.length}
        showNav={inspectorIndex >= 0 && inspectorList.length > 1}
        onPrev={() => stepInspector(-1)}
        onNext={() => stepInspector(1)}
        onClose={() => setInspectorImage(null)}
        onImageUpdated={(updated) => {
          // Keep the open inspector and the row behind it in step after a
          // hand-set scale, so the tooth outline and size appear at once.
          setInspectorImage((prev) => (prev ? { ...prev, ...updated } : prev));
          setActiveImage((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
        }}
        onAction={async (imgId, action) => {
          try {
            const res = await fetch(`/api/datasets/image/${imgId}/review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action }),
            });
            if (res.ok) {
              const updated = await res.json();
              setInspectorImage(prev => prev ? { ...prev, ...updated } : prev);
              setActiveImage(prev => prev && prev.id === imgId ? { ...prev, ...updated } : prev);
              try {
                const r = await fetch(`/api/datasets/dataset/${id}/review-queue?counts_only=1`);
                if (r.ok) setReviewSummary(await r.json());
              } catch {}
            }
          } catch {}
        }}
      />
    </Layout>
  );
}

// Summary tab. Answers one question: how much of this dataset can actually be
// measured in millimetres, and where are the losses. Every number is a button
// so the team can go straight from "525 have no scale bar" to looking at them.

// Completeness distribution, one small chart per species.
//
// Small multiples rather than one grouped chart: the question is the SHAPE of
// each species' distribution (does it cover the whole range, or pile up at
// nearly-complete?), and six overlaid series would hide exactly that.
//
// The bands are an ORDERED scale, so the fill is a single-hue ordinal ramp
// rather than six unrelated colours. Steps validated against the chart surface
// in both themes; the lightest still clears 2:1 so an empty-looking band is not
// mistaken for no bar at all.
const COMPLETENESS_BANDS = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
const BAND_FILL_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

function CompletenessDistribution({ species }) {
  const withBins = (species || []).filter(
    (s) => Array.isArray(s.completeness_bins) && s.completeness_bins.some((n) => n > 0),
  );
  if (!withBins.length) return null;

  // A dataset scored against ITSELF is the reference population, so these are
  // whole teeth being compared with the typical whole tooth of their species.
  // Calling that "how complete the fragments are" is simply wrong, and the
  // reading is different enough to deserve its own words: nothing here is
  // incomplete, so the spread is size variation between individuals, which is
  // exactly the noise floor for interpreting a fragment's percentage.
  const isReference = withBins.some((s) => s.completeness_reference?.is_self);

  return (
    <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
      <h2 className="text-base font-semibold text-gray-900">
        {isReference ? 'How much whole teeth vary in size' : 'How complete the fragments are'}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        {isReference ? (
          <>
            Every specimen here is a WHOLE tooth, each compared with the typical whole tooth of
            its species. Nothing is incomplete, so a value below 100% means a smaller than
            average individual, not a missing piece. Half of any population sits above its own
            median, which is why the top band is always the largest and the median always reads
            100%. The useful part is the lower tail: it is the natural size variation of the
            species, and it sets the accuracy limit for every fragment percentage.
          </>
        ) : (
          <>
            Each specimen measured against the median complete tooth of its species, grouped into
            the same 20% bands used for the qualitative binning. Bars show the share of that
            species, so the shapes stay comparable even though the species differ in size.
          </>
        )}
      </p>

      {/* Legend: identity is never carried by colour alone. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        {COMPLETENESS_BANDS.map((band, i) => (
          <span key={band} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: BAND_FILL_LIGHT[i] }}
            />
            {band}
          </span>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {withBins.map((s) => {
          const bins = s.completeness_bins;
          const n = bins.reduce((a, b) => a + b, 0);
          const shares = bins.map((c) => (n ? (c / n) * 100 : 0));
          // A shared 0-60% ceiling across every facet. Scaling each chart to its
          // own maximum would make a species with everything in one band look
          // identical to one spread evenly, which is the whole question.
          const CEILING = 60;
          return (
            <figure key={s.label_id} className="min-w-0">
              <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">{s.label}</span>
                <span className="text-xs text-gray-500 shrink-0">{n} measured</span>
              </figcaption>

              <div className="mt-2 flex items-end gap-[2px]" style={{ height: 96 }}>
                {bins.map((count, i) => {
                  const pct = shares[i];
                  const h = Math.max(pct > 0 ? 2 : 0, (pct / CEILING) * 96);
                  return (
                    <div
                      key={COMPLETENESS_BANDS[i]}
                      className="relative flex-1 flex flex-col justify-end"
                      title={`${s.label} · ${COMPLETENESS_BANDS[i]} complete · ${count} specimens (${pct.toFixed(0)}%)`}
                    >
                      <span className="block text-[10px] text-gray-500 text-center leading-none mb-1">
                        {count || ''}
                      </span>
                      <div
                        style={{
                          height: `${Math.min(h, 96)}px`,
                          background: BAND_FILL_LIGHT[i],
                          borderTopLeftRadius: 4,
                          borderTopRightRadius: 4,
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Hairline baseline, then the band labels under their bars. */}
              <div className="border-t border-gray-200" />
              <div className="flex gap-[2px] mt-1">
                {COMPLETENESS_BANDS.map((band) => (
                  <span key={band} className="flex-1 text-[9px] text-gray-400 text-center leading-tight">
                    {band.replace('%', '')}
                  </span>
                ))}
              </div>

              <p className="mt-1.5 text-xs text-gray-500">
                median <span className="text-gray-900 font-medium">{s.median_completeness_pct != null ? `${s.median_completeness_pct}%` : '-'}</span>
              </p>
            </figure>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-gray-500">
        {isReference ? (
          <>
            Read this as the error floor of the method rather than a result. Across all six
            species 21% of whole teeth measure under 60% of their species median, 9% under 40%
            and 2% under 20%; for Otodus megalodon, whose teeth vary most, it is 27%, 15% and 8%.
            So a fragment reported at 35% could be a genuinely small complete tooth, and for
            megalodon that happens about one time in eight. It is a limit of comparing against a
            species average, not a measurement error.
          </>
        ) : (
          <>
            A specimen is compared with the median complete tooth of its species, not with the
            individual tooth it broke from, which is unknowable from a photograph. Read a value as
            a population estimate: within a species complete teeth vary widely in size, so a single
            percentage carries real uncertainty even when the measurement itself is exact.
          </>
        )}
      </p>
    </div>
  );
}

function ScaleSummaryPanel({ summary, onOpenReview, datasetId }) {
  const router = useRouter();
  const [openSpecies, setOpenSpecies] = useState(null);
  const t = summary.totals || {};
  const species = summary.by_species || [];
  const flags = (summary.by_flag || []).filter((f) => f.count > 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  // Every count on this panel is a link into the review queue, filtered to
  // exactly the images behind it. A number the team cannot open is a number
  // they cannot act on.
  const openQueue = (params) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`/datasets/${datasetId}/review${qs ? `?${qs}` : ''}`);
  };

  // Renders a count as a button when it leads somewhere, plain text when the
  // count is zero so there is nothing to open.
  const Drill = ({ count, params, className = '', children }) => {
    if (!count) return <span className={className}>{children ?? count}</span>;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); openQueue(params); }}
        className={`${className} underline decoration-dotted underline-offset-4 hover:decoration-solid`}
        title="Open these in the review queue"
      >
        {children ?? count}
      </button>
    );
  };

  const Bar = ({ value, total, tone = 'blue' }) => {
    const tones = { blue: 'bg-blue-500', amber: 'bg-amber-500', gray: 'bg-gray-300' };
    return (
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${tones[tone]}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
    );
  };

  return (
    <div className="space-y-6 mb-6">
      {/* Headline */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
        <h2 className="text-base font-semibold text-gray-900">Measurement coverage</h2>
        <p className="mt-1 text-sm text-gray-500">
          How many photographs carry a readable scale bar, which is what makes a
          physical (mm) measurement possible.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Images', value: t.images, sub: null, params: null },
            { label: 'Calibrated', value: t.calibrated, sub: `${t.calibrated_pct}% of dataset`,
              tone: 'text-blue-700', params: { state: 'calibrated' } },
            { label: 'No calibration', value: t.uncalibrated, sub: 'cannot be measured yet',
              tone: 'text-amber-700', params: { state: 'uncalibrated' } },
            { label: 'Museum label read', value: t.with_ocr, sub: 'specimen metadata via OCR', params: null },
          ].map((c) => (
            <div key={c.label}>
              <div className={`text-2xl font-semibold ${c.tone || 'text-gray-900'}`}>
                {c.params ? (
                  <Drill count={c.value} params={c.params}>
                    {(c.value ?? 0).toLocaleString()}
                  </Drill>
                ) : (c.value ?? 0).toLocaleString()}
              </div>
              <div className="text-sm font-medium text-gray-700">{c.label}</div>
              {c.sub && <div className="text-xs text-gray-500">{c.sub}</div>}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <Bar value={t.calibrated || 0} total={t.images || 1} />
        </div>
      </div>

      {/* Per species */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
        <h2 className="text-base font-semibold text-gray-900">By species</h2>
        <p className="mt-1 text-sm text-gray-500">
          Click a row to see its measurement range. A species whose tooth sizes
          sit outside the biologically expected range is a calibration warning.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Species</th>
                <th className="py-2 pr-4 font-medium text-right">Images</th>
                <th className="py-2 pr-4 font-medium text-right">Calibrated</th>
                <th className="py-2 pr-4 font-medium w-40">Coverage</th>
                <th className="py-2 pr-4 font-medium text-right">Median tooth</th>
                <th className="py-2 font-medium text-right">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {species.map((s) => {
                const open = openSpecies === s.label_id;
                return (
                  <Fragment key={s.label_id}>
                    <tr
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setOpenSpecies(open ? null : s.label_id)}
                    >
                      <td className="py-2.5 pr-4 font-medium text-gray-900">
                        <span className="inline-block w-3 text-gray-400">{open ? '−' : '+'}</span> {s.label}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-gray-700">{s.total}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-700">
                        <Drill count={s.calibrated} params={{ label: s.label_id, state: 'calibrated' }}>
                          {s.calibrated}
                        </Drill>{' '}
                        <span className="text-gray-400">({s.calibrated_pct}%)</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Bar value={s.calibrated} total={s.total} tone={s.calibrated_pct < 70 ? 'amber' : 'blue'} />
                      </td>
                      <td className="py-2.5 pr-4 text-right text-gray-700">
                        {s.median_tooth_mm != null ? `${s.median_tooth_mm} mm` : '-'}
                      </td>
                      <td className="py-2.5 text-right text-amber-700">
                        <Drill count={s.uncalibrated}
                               params={{ label: s.label_id, state: 'uncalibrated' }}
                               className="text-amber-700">
                          {s.uncalibrated || ''}
                        </Drill>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-4 py-3">
                          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4 text-xs">
                            <div>
                              <dt className="text-gray-500">Tooth size range</dt>
                              <dd className="text-gray-900">
                                {s.min_tooth_mm != null ? `${s.min_tooth_mm} to ${s.max_tooth_mm} mm` : 'not measured'}
                              </dd>
                            </div>
                            {/* The median beside the extremes. Min and max are
                                single specimens and say nothing about where the
                                bulk of a species sits; the median does. */}
                            <div>
                              <dt className="text-gray-500">Median tooth</dt>
                              <dd className="text-gray-900">
                                {s.median_tooth_mm != null ? `${s.median_tooth_mm} mm` : 'not measured'}
                                {s.median_tooth_mm != null && (
                                  <span className="block text-gray-500">crown length, half are smaller</span>
                                )}
                              </dd>
                            </div>
                            {/* Area is the quantity completeness divides by, so
                                it is shown rather than left implicit. */}
                            <div>
                              <dt className="text-gray-500">Median area</dt>
                              <dd className="text-gray-900">
                                {s.median_area_mm2 != null ? `${s.median_area_mm2} mm\u00b2` : 'not measured'}
                                {s.median_area_mm2 != null && (
                                  <span className="block text-gray-500">outline only, drives completeness</span>
                                )}
                              </dd>
                            </div>
                            {/* What each percentage was divided by, and from
                                where. A dataset's own median sitting beside
                                completeness computed against a DIFFERENT
                                dataset's median is otherwise invisible. */}
                            {s.completeness_reference && !s.completeness_reference.is_self && (
                              <div>
                                <dt className="text-gray-500">Measured against</dt>
                                <dd className="text-gray-900">
                                  {s.completeness_reference.area_mm2} mm&sup2;
                                  <span className="block text-gray-500">
                                    median complete tooth, {s.completeness_reference.dataset}
                                  </span>
                                  {s.median_area_mm2 != null && s.completeness_reference.area_mm2 > 0 && (() => {
                                    const ratio = s.median_area_mm2 / s.completeness_reference.area_mm2;
                                    // A fragment cannot exceed the whole tooth it
                                    // broke from, so a ratio above 1 is not a
                                    // measurement result: the two populations are
                                    // not comparable and the percentages for this
                                    // species mean nothing.
                                    if (ratio <= 1.05) {
                                      return (
                                        <span className="block text-gray-500">
                                          this set is {ratio.toFixed(2)}× the reference
                                        </span>
                                      );
                                    }
                                    return (
                                      <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-amber-900 ring-1 ring-amber-200">
                                        <b>{ratio.toFixed(2)}× the reference.</b> These specimens
                                        measure larger than the complete teeth they are scored
                                        against, which cannot happen. The reference population
                                        is unrepresentative, so completeness for this species is
                                        not meaningful.
                                      </span>
                                    );
                                  })()}
                                </dd>
                              </div>
                            )}
                            <div>
                              <dt className="text-gray-500">Museum label read</dt>
                              <dd className="text-gray-900">{s.with_ocr} of {s.total}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">Completeness computed</dt>
                              <dd className="text-gray-900">{s.with_completeness} of {s.total}</dd>
                            </div>
                            <div>
                              <dt className="text-gray-500">Not measurable</dt>
                              <dd className="text-amber-700">{s.uncalibrated}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CompletenessDistribution species={species} />

      {/* Why images are not usable */}
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">What needs attention</h2>
            <p className="mt-1 text-sm text-gray-500">
              Each bucket is a reason an image is not finished. Open the review
              queue to inspect them one by one.
            </p>
          </div>
          <button className={theme.classes.btnSecondary} onClick={onOpenReview}>
            Open review queue
          </button>
        </div>
        <ul className="mt-4 divide-y divide-gray-100">
          {flags.length === 0 && (
            <li className="py-3 text-sm text-gray-500">Nothing flagged. Every image is resolved.</li>
          )}
          {flags.map((f) => (
            <li key={f.key}>
              <button
                onClick={() => openQueue({ flag: f.key })}
                className="flex w-full items-center justify-between py-2.5 text-left hover:bg-gray-50"
                title="Open these in the review queue"
              >
                <span className="text-sm text-gray-800">{f.label}</span>
                <span className="text-sm font-semibold text-gray-900 underline decoration-dotted underline-offset-4">
                  {f.count.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Images under {summary.low_resolution_threshold_px} px on the long edge are counted
          separately because no re-processing can recover a measurement from them. They stay
          usable for classification.
        </p>
      </div>
    </div>
  );
}

function PipelinePanel({ dataset, stats, reviewCounts, flaggedCount, problemCount = 0, pendingReviewCount = 0, onRunOcr, onComputeMm2, onOpenReview, onEmitModeA, onEmitModeB }) {
  // Modes-help dialog: explains the A / A+ / B comparison researchers
  // run side-by-side for the paper. Opens on the (i) icon next to the
  // Emit buttons so the explanation appears right when the user is about
  // to click.
  const [showModesHelp, setShowModesHelp] = useState(false);
  const total = stats?.total_images ?? 0;
  const ocrEligible   = stats?.ocr_eligible_count   ?? total;
  const calibEligible = stats?.calib_eligible_count ?? total;
  const ocr = stats?.with_ocr ?? 0;
  const cal = stats?.with_calibration ?? 0;
  const reviewedCount = reviewCounts?.reviewed ?? 0;
  const excludedCount = reviewCounts?.excluded ?? 0;
  const unreviewedCount = reviewCounts?.unreviewed ?? 0;
  const derivedCount = stats?.derived_datasets_count ?? 0;
  const sourceKinds = stats?.source_kind_counts || {};

  // Each step's status: 'done' | 'partial' | 'attention' | 'todo'
  const stepUpload = total > 0 ? 'done' : 'todo';

  // OCR is only meaningful on RAW (or unknown-source) images; MASKED and
  // PROCESSED images are excluded from both numerator and denominator.
  const stepOcr = ocrEligible === 0 ? 'done' // no images need OCR (e.g. all MASKED)
    : ocr === 0 ? 'todo'
    : ocr < ocrEligible ? 'partial'
    : 'done';

  // Calibration excludes PROCESSED-tagged images (scale bar already gone).
  const stepCal = calibEligible === 0 ? 'done'
    : cal === 0 ? 'todo'
    : cal < calibEligible ? 'partial'
    : 'done';

  // Review is complete when nothing is UNRESOLVED, not when every image has
  // been individually approved.
  //
  // The old rule required all 4,326 images to be opened one by one. At the
  // pace a reviewer actually sustains that is about 150 hours, so the step sat
  // amber permanently and stopped carrying any information: it looked the same
  // whether the queue was full of real problems or completely clear.
  //
  // The agreed workflow is full coverage where a human is REQUIRED - images the
  // detector could not measure - and spot-checking everywhere else. Opening the
  // remaining thousands would surface the same issues the first hundred did.
  // So the gate tracks the problem buckets, and the untouched count is reported
  // beside it as information rather than as a blocker.
  const stepReview = total === 0 ? 'todo'
    : problemCount > 0 ? 'attention'
    : 'done';

  const stepEmit = derivedCount > 0 ? 'done' : 'todo';

  // First non-done step drives the "Next" CTA.
  const order = [
    { key: 'upload',  status: stepUpload  },
    { key: 'ocr',     status: stepOcr     },
    { key: 'cal',     status: stepCal     },
    { key: 'review',  status: stepReview  },
    { key: 'emit',    status: stepEmit    },
  ];
  const nextStep = order.find((s) => s.status !== 'done')?.key;

  const stepDot = (status) => {
    if (status === 'done')      return 'bg-green-500';
    if (status === 'attention') return 'bg-amber-500';
    if (status === 'partial')   return 'bg-blue-500';
    return 'bg-gray-300';
  };
  const stepIcon = (status) => {
    if (status === 'done')      return '✓';
    if (status === 'attention') return '!';
    if (status === 'partial')   return '◐';
    return '○';
  };

  return (
    <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl mb-6 p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Phase 2 Pipeline</h2>
          <p className="text-xs text-gray-500">Source-resolution dataset. Each step prepares this set for the next.</p>
        </div>
        {derivedCount > 0 && (
          <span className="text-xs text-gray-500">
            {derivedCount} derived dataset{derivedCount !== 1 ? 's' : ''} produced
          </span>
        )}
      </div>

      {/* Step row */}
      <div className="flex items-center justify-between gap-2 mb-4 overflow-x-auto pb-2">
        <Step icon={stepIcon(stepUpload)} dot={stepDot(stepUpload)} label="Upload"     value={`${total} image${total !== 1 ? 's' : ''}`} active={nextStep === 'upload'} />
        <StepLine />
        <Step icon={stepIcon(stepOcr)}    dot={stepDot(stepOcr)}    label="OCR"        value={ocrEligible === 0 ? 'n/a' : `${ocr}/${ocrEligible} Raw`} active={nextStep === 'ocr'} />
        <StepLine />
        <Step icon={stepIcon(stepCal)}    dot={stepDot(stepCal)}    label="Calibrate"  value={calibEligible === 0 ? 'n/a' : `${cal}/${calibEligible}`} active={nextStep === 'cal'} />
        <StepLine />
        <Step
          icon={stepIcon(stepReview)}
          dot={stepDot(stepReview)}
          label="Review"
          value={problemCount > 0
            ? `${problemCount} to resolve`
            : `no problems · ${reviewedCount} checked`}
          active={nextStep === 'review'}
        />
        <StepLine />
        <Step icon={stepIcon(stepEmit)}   dot={stepDot(stepEmit)}   label="Emit"       value={derivedCount > 0 ? `${derivedCount} derived` : 'not yet'} active={nextStep === 'emit'} />
      </div>

      {/* Source-kind breakdown when there's a mix */}
      {(sourceKinds.raw > 0 || sourceKinds.masked > 0 || sourceKinds.unknown > 0) && (
        <div className="mb-3 text-[11px] text-gray-500">
          Image kinds:
          {sourceKinds.raw > 0    && <> <span className="font-medium text-gray-700">{sourceKinds.raw} Raw</span></>}
          {sourceKinds.masked > 0 && <> · <span className="font-medium text-gray-700">{sourceKinds.masked} Masked</span></>}
          {sourceKinds.processed > 0 && <> · <span className="font-medium text-gray-700">{sourceKinds.processed} Processed</span></>}
          {sourceKinds.unknown > 0 && <> · <span className="font-medium text-gray-700">{sourceKinds.unknown} unknown</span></>}
          <span className="text-gray-400"> · OCR applies to Raw only · Calibration applies to Raw + Masked</span>
        </div>
      )}

      {/* Next-action CTA */}
      <div className="rounded-md bg-gray-50 ring-1 ring-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
        {nextStep === 'upload' && (
          <span className="text-sm text-gray-700">Upload images via <strong>Actions → Bulk Upload Images</strong> to begin.</span>
        )}
        {nextStep === 'ocr' && (
          <>
            <span className="text-sm text-gray-700">Next: <strong>Run FLMNH Label OCR</strong> to extract museum metadata.</span>
            <button onClick={onRunOcr} className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">Run OCR</button>
          </>
        )}
        {nextStep === 'cal' && (
          <>
            <span className="text-sm text-gray-700">Next: <strong>Compute Completeness (mm²)</strong> to calibrate the dataset.</span>
            <button onClick={onComputeMm2} className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">Compute mm²</button>
          </>
        )}
        {nextStep === 'review' && (
          <>
            <span className="text-sm text-gray-700">
              Next: <strong>Resolve {problemCount} image{problemCount !== 1 ? 's' : ''}</strong> the
              system could not finish on its own.
            </span>
            <button onClick={onOpenReview} className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
              Open Review Queue ({problemCount})
            </button>
          </>
        )}
        {nextStep === 'emit' && (
          <>
            <span className="text-sm text-gray-700">
              Next: <strong>Emit Processed datasets</strong> for model training.
              {' '}<span className="text-gray-500">
                No unresolved problems. {reviewedCount} image{reviewedCount !== 1 ? 's' : ''} individually
                checked; the rest passed the automatic checks and were not opened one by one.
              </span>
              <button
                type="button"
                onClick={() => setShowModesHelp(true)}
                className="ml-1 inline-flex items-center align-middle text-blue-600 hover:text-blue-700"
                title="What's the difference between Mode A, A+ and B?"
              >
                <InformationCircleIcon className="h-4 w-4" />
              </button>
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={onEmitModeA} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">Emit Mode A</button>
              <button onClick={onEmitModeB} className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Emit Mode B</button>
            </div>
          </>
        )}
        {!nextStep && (
          <span className="text-sm text-green-800 font-medium">
            ✓ Pipeline complete. {derivedCount} derived dataset{derivedCount !== 1 ? 's' : ''} ready for training.
            <button
              type="button"
              onClick={() => setShowModesHelp(true)}
              className="ml-1 inline-flex items-center align-middle text-blue-600 hover:text-blue-700"
              title="What's the difference between Mode A, A+ and B?"
            >
              <InformationCircleIcon className="h-4 w-4" />
            </button>
          </span>
        )}
      </div>
      <ModesHelpDialog open={showModesHelp} onClose={() => setShowModesHelp(false)} />
    </div>
  );
}

function ModesHelpDialog({ open, onClose }) {
  // Single source of truth for the A / A+ / B explanation, shown on the
  // Emit step's info icon. Mode A and Mode B are distinct emit choices
  // (they produce different Processed datasets). A+ is NOT a separate
  // emit choice: it reuses the Mode A dataset and flips the training
  // launch dialog's "Input mode" to "image + size scalars". The dialog
  // makes that explicit so a researcher does not look for a missing
  // 'Emit Mode A+' button.
  const modes = [
    {
      key: 'A',
      title: 'Mode A',
      subtitle: 'Uniform canvas, image-only training',
      emit: 'Emit Mode A',
      training: 'Input mode: image_only',
      pixels: 'Each tooth is rescaled to fill the 384×384 canvas. Scale bar is cropped out.',
      detail: 'Detail preserved on every tooth, big or small.',
      size: 'Absolute physical size is lost. The model cannot tell a small Galeocerdo from a Megalodon by size.',
      tone: 'border-blue-200 bg-blue-50',
      chip: 'bg-blue-600 text-white',
    },
    {
      key: 'A+',
      title: 'Mode A+',
      subtitle: 'Uniform canvas, image + size scalars at training',
      emit: 'Emit Mode A (same dataset)',
      training: 'Input mode: image_plus_size',
      pixels: 'Same Mode A images. The model also receives a 4-dim scalar vector [length, width, area, completeness] in mm per image.',
      detail: 'Detail preserved (Mode A image).',
      size: 'Restored as a separate input head, the model sees absolute size without sacrificing pixel detail.',
      tone: 'border-violet-200 bg-violet-50',
      chip: 'bg-violet-600 text-white',
    },
    {
      key: 'B',
      title: 'Mode B',
      subtitle: 'Scale-preserving canvas, image-only training',
      emit: 'Emit Mode B',
      training: 'Input mode: image_only',
      pixels: '1 mm in the output equals a fixed number of pixels (default 6 px/mm). A small tooth fills a small region of the canvas.',
      detail: 'Detail is downsampled for small teeth (a close-up of a 15 mm tooth gets shrunk to fit the fixed mm/px ratio).',
      size: 'Encoded in canvas occupancy. The model can infer size by how much of the frame the tooth covers.',
      tone: 'border-amber-200 bg-amber-50',
      chip: 'bg-amber-600 text-white',
    },
  ];
  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150"   leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-gray-900/60" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"   leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95">
              <Dialog.Panel className="relative w-full max-w-5xl rounded-xl bg-white shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                  <Dialog.Title className="text-base font-semibold text-gray-900">
                    Processed Modes: A, A+ and B
                  </Dialog.Title>
                  <button onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100">
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <div className="px-5 py-4">
                  <p className="text-sm text-gray-600 mb-4">
                    Each Processed dataset is 384×384 PNGs ready for the
                    classifier. The three configurations below differ in how
                    physical size is exposed to the model.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {modes.map(m => (
                      <div key={m.key} className={`rounded-lg border ${m.tone} px-4 py-3`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold ${m.chip}`}>{m.key}</span>
                          <h3 className="text-sm font-semibold text-gray-900">{m.title}</h3>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">{m.subtitle}</p>
                        <dl className="space-y-2 text-xs">
                          <div>
                            <dt className="font-semibold text-gray-700">Emit step</dt>
                            <dd className="text-gray-600">{m.emit}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-700">Training step</dt>
                            <dd className="text-gray-600">{m.training}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-700">Pixels</dt>
                            <dd className="text-gray-600">{m.pixels}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-700">Detail</dt>
                            <dd className="text-gray-600">{m.detail}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-gray-700">Size info</dt>
                            <dd className="text-gray-600">{m.size}</dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-50 px-5 py-3 flex justify-end border-t border-gray-200">
                  <button onClick={onClose} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500">
                    Got it
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

function Step({ icon, dot, label, value, active }) {
  return (
    <div className={`flex flex-col items-center gap-1 min-w-[120px] ${active ? '' : 'opacity-80'}`}>
      <div className={`h-7 w-7 rounded-full ${dot} text-white text-sm font-bold flex items-center justify-center shadow ${active ? 'ring-4 ring-blue-200' : ''}`}>
        {icon}
      </div>
      <div className={`text-xs font-semibold text-gray-900 ${active ? '' : ''}`}>{label}</div>
      <div className="text-[11px] text-gray-500 text-center whitespace-nowrap">{value}</div>
    </div>
  );
}

function StepLine() {
  return <div className="flex-1 h-px bg-gray-200 min-w-[12px]" />;
}

function ReviewStatusBlock({ image, onChanged, onInspect }) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const status = image.review_status || 'unreviewed';
  const reviewedAt = image.reviewed_at ? new Date(image.reviewed_at).toLocaleString() : null;
  const chipClasses = {
    unreviewed: 'bg-gray-100 text-gray-700 ring-gray-200',
    reviewed:   'bg-green-50 text-green-800 ring-green-200',
    excluded:   'bg-red-50 text-red-800 ring-red-200',
  }[status] || 'bg-gray-100 text-gray-700 ring-gray-200';

  const apply = async (action) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/datasets/image/${image.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (onChanged) onChanged(updated);
      }
    } finally {
      setBusy(false);
    }
  };

  const fileName = image.image?.split('/').pop()?.split('?')[0] || `image #${image.id}`;
  const confirmConfig = {
    mark_reviewed: {
      title: 'Mark as reviewed?',
      message: `Mark ${fileName} as reviewed. It will be counted as approved in the pipeline.`,
      confirmLabel: 'Mark Reviewed',
      tone: 'primary',
    },
    mark_unreviewed: {
      title: 'Reset to unreviewed?',
      message: `Send ${fileName} back to the unreviewed pool. Any previous reviewed/excluded decision will be cleared but the audit log keeps the history.`,
      confirmLabel: 'Mark Unreviewed',
      tone: 'primary',
    },
    mark_excluded: {
      title: 'Exclude from the dataset?',
      message: `Exclude ${fileName}. It will not be used downstream until you re-include it.`,
      confirmLabel: 'Exclude',
      tone: 'danger',
    },
  };

  return (
    <div>
      <dt className="font-medium text-gray-500">Review Status</dt>
      <dd className="text-gray-900 text-xs space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset capitalize ${chipClasses}`}>
            {status}
          </span>
          {reviewedAt && (
            <span className="text-gray-400">last touched {reviewedAt}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {onInspect && (
            <button type="button" onClick={onInspect} className="rounded-md bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gray-800">
              Inspect
            </button>
          )}
          {status !== 'reviewed' && (
            <button type="button" disabled={busy} onClick={() => setPending('mark_reviewed')} className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
              Mark Reviewed
            </button>
          )}
          {(status === 'reviewed' || status === 'excluded') && (
            <button type="button" disabled={busy} onClick={() => setPending('mark_unreviewed')} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50">
              Mark Unreviewed
            </button>
          )}
          {status !== 'excluded' && (
            <button type="button" disabled={busy} onClick={() => setPending('mark_excluded')} className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50">
              Exclude
            </button>
          )}
        </div>
      </dd>
      <ConfirmDialog
        isOpen={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => { const action = pending; setPending(null); if (action) apply(action); }}
        title={pending ? confirmConfig[pending].title : ''}
        message={pending ? confirmConfig[pending].message : ''}
        confirmLabel={pending ? confirmConfig[pending].confirmLabel : 'Confirm'}
        confirmTone={pending ? confirmConfig[pending].tone : 'primary'}
      />
    </div>
  );
}
