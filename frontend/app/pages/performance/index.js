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

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';
import theme from '../../theme';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';

const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#be185d', '#4d7c0f', '#b45309', '#6d28d9',
];

function getColor(idx) {
  return COLORS[idx % COLORS.length];
}

// Card wrapper used throughout the page
function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-6 ${className}`}>
      {title && <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

// Stat card for the summary row
function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-5 text-center">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-blue-600">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function Performance() {
  const router = useRouter();
  const [selectedStudyId, setSelectedStudyId] = useState(null);
  const [perfData, setPerfData] = useState(null);
  const [isPerfLoading, setIsPerfLoading] = useState(false);
  const [sortCol, setSortCol] = useState('accuracy');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedTestIdx, setSelectedTestIdx] = useState(0);

  // Tab state
  const [activeTab, setActiveTab] = useState('study');

  // Compare Studies state
  const [allStudies, setAllStudies] = useState([]);
  const [selectedCompareIds, setSelectedCompareIds] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const [compareSortCol, setCompareSortCol] = useState('avg_accuracy');
  const [compareSortDir, setCompareSortDir] = useState('desc');

  // Sync with sidebar's selected study via localStorage
  useEffect(() => {
    const stored = localStorage.getItem('selectedStudy');
    if (stored) setSelectedStudyId(Number(stored));

    // Listen for sidebar study changes (same tab updates)
    const interval = setInterval(() => {
      const current = localStorage.getItem('selectedStudy');
      if (current && Number(current) !== selectedStudyId) {
        setSelectedStudyId(Number(current));
      }
    }, 500);

    // Listen for cross-tab storage changes
    const onStorage = (e) => {
      if (e.key === 'selectedStudy' && e.newValue) {
        setSelectedStudyId(Number(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [selectedStudyId]);

  // Fetch studies list (needed for Compare tab)
  useEffect(() => {
    const fetchStudies = async () => {
      try {
        const res = await fetch('/api/feature_extractor/studies/');
        const data = await res.json();
        setAllStudies(Array.isArray(data) ? data : data.results || []);
      } catch (err) {
        console.error('Failed to fetch studies:', err);
      }
    };
    fetchStudies();
  }, []);

  // Fetch performance when study changes
  useEffect(() => {
    if (!selectedStudyId) return;
    const fetchPerf = async () => {
      setIsPerfLoading(true);
      try {
        const res = await fetch(`/api/feature_extractor/studies/${selectedStudyId}/performance`);
        const data = await res.json();
        setPerfData(data);
        setSelectedTestIdx(0);
      } catch (err) {
        console.error('Failed to fetch performance:', err);
        setPerfData(null);
      } finally {
        setIsPerfLoading(false);
      }
    };
    fetchPerf();
  }, [selectedStudyId]);

  // Fetch compare data
  const fetchCompare = async () => {
    if (selectedCompareIds.length < 2) return;
    setIsCompareLoading(true);
    try {
      const params = selectedCompareIds.map(id => `ids=${id}`).join('&');
      const res = await fetch(`/api/feature_extractor/studies/compare?${params}`);
      const data = await res.json();
      setCompareData(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch comparison:', err);
      setCompareData(null);
    } finally {
      setIsCompareLoading(false);
    }
  };

  // Build scatter data for accuracy vs sample size
  const accuracyScatterData = useMemo(() => {
    if (!perfData) return [];
    const points = [];
    const modelSet = new Set();
    (perfData.sessions || []).forEach((sess) => {
      (sess.tests || []).forEach((t) => {
        modelSet.add(sess.model_name);
        points.push({
          x: sess.avg_images_per_class,
          y: t.accuracy,
          model: sess.model_name,
          session: sess.session_name,
        });
      });
    });
    return { points, models: [...modelSet] };
  }, [perfData]);

  // Confidence vs sample size
  const confidenceScatterData = useMemo(() => {
    if (!perfData) return [];
    const points = [];
    const modelSet = new Set();
    (perfData.sessions || []).forEach((sess) => {
      (sess.tests || []).forEach((t) => {
        modelSet.add(sess.model_name);
        points.push({
          x: sess.avg_images_per_class,
          y: t.avg_confidence,
          model: sess.model_name,
          session: sess.session_name,
        });
      });
    });
    return { points, models: [...modelSet] };
  }, [perfData]);

  // Flat rows for cross-session comparison table
  const tableRows = useMemo(() => {
    if (!perfData) return [];
    const rows = [];
    (perfData.sessions || []).forEach((sess) => {
      const tests = sess.tests || [];
      if (tests.length === 0) {
        rows.push({
          sessionId: sess.session_id,
          sessionName: sess.session_name,
          model: sess.model_name,
          dataset: sess.dataset_name,
          resolution: sess.model_resolution,
          avgImgPerClass: sess.avg_images_per_class,
          accuracy: sess.best_val_accuracy,
          confidence: null,
          f1: null,
        });
      } else {
        tests.forEach((t) => {
          rows.push({
            sessionId: sess.session_id,
            sessionName: sess.session_name,
            model: sess.model_name,
            dataset: sess.dataset_name,
            resolution: sess.model_resolution,
            avgImgPerClass: sess.avg_images_per_class,
            accuracy: t.accuracy,
            confidence: t.avg_confidence,
            f1: t.macro_f1,
          });
        });
      }
    });
    return rows;
  }, [perfData]);

  // Sorted table rows
  const sortedRows = useMemo(() => {
    const sorted = [...tableRows];
    sorted.sort((a, b) => {
      const aVal = a[sortCol] ?? -1;
      const bVal = b[sortCol] ?? -1;
      if (typeof aVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [tableRows, sortCol, sortDir]);

  // Collect all tests for confusion matrix selector
  const allTests = useMemo(() => {
    if (!perfData) return [];
    const tests = [];
    (perfData.sessions || []).forEach((sess) => {
      (sess.tests || []).forEach((t) => {
        tests.push({ ...t, sessionName: sess.session_name });
      });
    });
    return tests;
  }, [perfData]);

  const selectedTest = allTests[selectedTestIdx] || null;

  // Per-class bar chart data from selected test
  const perClassData = useMemo(() => {
    if (!selectedTest || !selectedTest.per_class) return [];
    return selectedTest.per_class.map((c) => ({
      label: c.label,
      Precision: +(c.precision * 100).toFixed(1),
      Recall: +(c.recall * 100).toFixed(1),
      F1: +(c.f1 * 100).toFixed(1),
    }));
  }, [selectedTest]);

  // Model comparison bar data
  const modelCompData = useMemo(() => {
    if (!perfData || !perfData.model_comparison) return [];
    return perfData.model_comparison.map((m) => ({
      model: m.model_name,
      accuracy: +(m.avg_accuracy * 100).toFixed(1),
      tests: m.num_tests,
    }));
  }, [perfData]);

  // Training efficiency scatter
  const efficiencyData = useMemo(() => {
    if (!perfData) return [];
    return (perfData.sessions || []).map((sess) => ({
      x: sess.num_epochs,
      y: sess.best_val_accuracy,
      name: sess.session_name,
      model: sess.model_name,
    }));
  }, [perfData]);

  // Confusion matrix grid data
  const confusionGrid = useMemo(() => {
    if (!selectedTest || !selectedTest.confusion || !selectedTest.labels) return null;
    const labels = selectedTest.labels;
    const lookup = {};
    let maxCount = 1;
    selectedTest.confusion.forEach((c) => {
      const key = `${c.true_label}__${c.predicted}`;
      lookup[key] = c.count;
      if (c.count > maxCount) maxCount = c.count;
    });
    return { labels, lookup, maxCount };
  }, [selectedTest]);

  // Compare tab: sorted rows
  const sortedCompareData = useMemo(() => {
    if (!compareData) return [];
    const sorted = [...compareData];
    sorted.sort((a, b) => {
      const aVal = a[compareSortCol] ?? -1;
      const bVal = b[compareSortCol] ?? -1;
      if (typeof aVal === 'string') {
        return compareSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return compareSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [compareData, compareSortCol, compareSortDir]);

  // Compare tab: bar chart data
  const compareBarData = useMemo(() => {
    if (!compareData) return [];
    return compareData.map((s) => ({
      name: s.study_name.length > 25 ? s.study_name.slice(0, 25) + '...' : s.study_name,
      fullName: s.study_name,
      'Avg Accuracy': +(s.avg_accuracy * 100).toFixed(1),
      'Avg Confidence': +(s.avg_confidence * 100).toFixed(1),
    }));
  }, [compareData]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const handleCompareSort = (col) => {
    if (compareSortCol === col) {
      setCompareSortDir(compareSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setCompareSortCol(col);
      setCompareSortDir('desc');
    }
  };

  const sortArrow = (col) => {
    if (sortCol !== col) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const compareSortArrow = (col) => {
    if (compareSortCol !== col) return '';
    return compareSortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  // Compare: toggle study selection
  const toggleCompareStudy = (id) => {
    setSelectedCompareIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const allCompareSelected = allStudies.length > 0 && selectedCompareIds.length === allStudies.length;
  const someCompareSelected = selectedCompareIds.length > 0 && selectedCompareIds.length < allStudies.length;

  const toggleCompareAll = () => {
    if (allCompareSelected) {
      setSelectedCompareIds([]);
    } else {
      setSelectedCompareIds(allStudies.map((s) => s.id));
    }
  };

  const tabClasses = (active) =>
    `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      active
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    }`;

  const currentStudyName = allStudies.find(s => s.id === selectedStudyId)?.name;

  return (
    <Layout>
      <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Study Performance</h1>
          <p className="mt-1 text-sm text-gray-500">
            Analyze training and testing metrics across sessions
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200">
          <button type="button" className={tabClasses(activeTab === 'study')} onClick={() => setActiveTab('study')}>
            Study Performance
          </button>
          <button type="button" className={tabClasses(activeTab === 'compare')} onClick={() => setActiveTab('compare')}>
            Compare Studies
          </button>
        </div>

        {/* ===== STUDY PERFORMANCE TAB ===== */}
        {activeTab === 'study' && (
          <>
            {!selectedStudyId && (
              <Card>
                <p className="text-sm text-gray-400 text-center py-12">Select a study from the sidebar to view performance data</p>
              </Card>
            )}

            {isPerfLoading && (
              <div className="flex items-center justify-center h-48">
                <Spinner />
              </div>
            )}

            {!isPerfLoading && perfData && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard label="Total Sessions" value={perfData.summary?.total_sessions ?? 0} />
                  <StatCard label="Total Tests" value={perfData.summary?.total_tests ?? 0} />
                  <StatCard
                    label="Best Accuracy"
                    value={`${((perfData.summary?.best_accuracy ?? 0) * 100).toFixed(1)}%`}
                  />
                  <StatCard
                    label="Avg Accuracy"
                    value={`${((perfData.summary?.avg_accuracy ?? 0) * 100).toFixed(1)}%`}
                  />
                </div>

                {/* Charts row 1: Accuracy and Confidence scatter plots */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Accuracy vs Sample Size */}
                  <Card title="Accuracy vs Sample Size">
                    {accuracyScatterData.points?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="x" name="Avg Images/Class" type="number" label={{ value: 'Avg Images per Class', position: 'insideBottom', offset: -10 }} />
                          <YAxis dataKey="y" name="Accuracy" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                          <RechartsTooltip formatter={(val, name) => name === 'Accuracy' ? `${(val * 100).toFixed(1)}%` : val} />
                          <Legend />
                          {(accuracyScatterData.models || []).map((model, i) => (
                            <Scatter
                              key={model}
                              name={model}
                              data={accuracyScatterData.points.filter((p) => p.model === model)}
                              fill={getColor(i)}
                            />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-12">No test data available</p>
                    )}
                  </Card>

                  {/* Confidence vs Sample Size */}
                  <Card title="Confidence vs Sample Size">
                    {confidenceScatterData.points?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="x" name="Avg Images/Class" type="number" label={{ value: 'Avg Images per Class', position: 'insideBottom', offset: -10 }} />
                          <YAxis dataKey="y" name="Confidence" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                          <RechartsTooltip formatter={(val, name) => name === 'Confidence' ? `${(val * 100).toFixed(1)}%` : val} />
                          <Legend />
                          {(confidenceScatterData.models || []).map((model, i) => (
                            <Scatter
                              key={model}
                              name={model}
                              data={confidenceScatterData.points.filter((p) => p.model === model)}
                              fill={getColor(i)}
                            />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-12">No test data available</p>
                    )}
                  </Card>
                </div>

                {/* Cross-Session Comparison Table */}
                <Card title="Cross-Session Comparison">
                  {sortedRows.length > 0 ? (
                    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr>
                            {[
                              { key: 'sessionName', label: 'Session' },
                              { key: 'model', label: 'Model' },
                              { key: 'dataset', label: 'Dataset' },
                              { key: 'resolution', label: 'Resolution' },
                              { key: 'avgImgPerClass', label: 'Avg Img/Class' },
                              { key: 'accuracy', label: 'Accuracy' },
                              { key: 'confidence', label: 'Confidence' },
                              { key: 'f1', label: 'F1' },
                            ].map((col) => (
                              <th
                                key={col.key}
                                className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 cursor-pointer select-none hover:text-blue-600"
                                onClick={() => handleSort(col.key)}
                              >
                                {col.label}{sortArrow(col.key)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortedRows.map((row, i) => (
                            <tr
                              key={`${row.sessionId}-${i}`}
                              className="cursor-pointer hover:bg-blue-50 transition-colors"
                              onClick={() => router.push(`/training/${row.sessionId}`)}
                            >
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-blue-600 font-medium">{row.sessionName}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{row.model}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{row.dataset}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{row.resolution}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{row.avgImgPerClass}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium">
                                {row.accuracy != null ? `${(row.accuracy * 100).toFixed(1)}%` : '-'}
                              </td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                {row.confidence != null ? `${(row.confidence * 100).toFixed(1)}%` : '-'}
                              </td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                {row.f1 != null ? row.f1.toFixed(3) : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-8">No session data available</p>
                  )}
                </Card>

                {/* Confusion Matrix */}
                <Card title="Confusion Matrix">
                  {allTests.length > 1 && (
                    <div className="mb-4">
                      <select
                        className="rounded-md border-0 py-1.5 pl-3 pr-8 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-blue-600"
                        value={selectedTestIdx}
                        onChange={(e) => setSelectedTestIdx(Number(e.target.value))}
                      >
                        {allTests.map((t, i) => (
                          <option key={i} value={i}>
                            {t.sessionName} - {t.test_name} (Acc: {(t.accuracy * 100).toFixed(1)}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {confusionGrid ? (
                    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                      <div className="inline-block">
                        {/* Header row */}
                        <div className="flex">
                          <div className="w-24 h-8 flex items-center justify-center text-xs font-semibold text-gray-500">True \ Pred</div>
                          {confusionGrid.labels.map((label) => (
                            <div key={label} className="w-16 h-8 flex items-center justify-center text-xs font-medium text-gray-700 truncate" title={label}>
                              {label.length > 6 ? label.slice(0, 6) + '..' : label}
                            </div>
                          ))}
                        </div>
                        {/* Data rows */}
                        {confusionGrid.labels.map((trueLabel) => (
                          <div key={trueLabel} className="flex">
                            <div className="w-24 h-12 flex items-center justify-end pr-2 text-xs font-medium text-gray-700 truncate" title={trueLabel}>
                              {trueLabel.length > 10 ? trueLabel.slice(0, 10) + '..' : trueLabel}
                            </div>
                            {confusionGrid.labels.map((predLabel) => {
                              const count = confusionGrid.lookup[`${trueLabel}__${predLabel}`] || 0;
                              const intensity = count / confusionGrid.maxCount;
                              const isDiag = trueLabel === predLabel;
                              const bg = isDiag
                                ? `rgba(37, 99, 235, ${0.1 + intensity * 0.8})`
                                : count > 0
                                  ? `rgba(239, 68, 68, ${0.1 + intensity * 0.6})`
                                  : 'rgba(249, 250, 251, 1)';
                              const textColor = intensity > 0.5 ? 'white' : 'rgb(55, 65, 81)';
                              return (
                                <div
                                  key={predLabel}
                                  className="w-16 h-12 flex items-center justify-center text-xs font-medium border border-gray-100"
                                  style={{ backgroundColor: bg, color: textColor }}
                                >
                                  {count > 0 ? count : ''}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-8">No confusion data available</p>
                  )}
                </Card>

                {/* Charts row 2: Per-Class and Model Comparison */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Per-Class Performance */}
                  <Card title="Per-Class Performance">
                    {perClassData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={Math.max(300, perClassData.length * 40)}>
                        <BarChart data={perClassData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                          <YAxis dataKey="label" type="category" width={75} tick={{ fontSize: 12 }} />
                          <RechartsTooltip formatter={(v) => `${v}%`} />
                          <Legend />
                          <Bar dataKey="Precision" fill="#2563eb" barSize={10} />
                          <Bar dataKey="Recall" fill="#16a34a" barSize={10} />
                          <Bar dataKey="F1" fill="#d97706" barSize={10} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-12">Select a test to view per-class metrics</p>
                    )}
                  </Card>

                  {/* Model Architecture Comparison */}
                  <Card title="Model Architecture Comparison">
                    {modelCompData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={modelCompData} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="model" tick={{ fontSize: 11, angle: -30 }} textAnchor="end" height={60} />
                          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                          <RechartsTooltip formatter={(v) => `${v}%`} />
                          <Bar dataKey="accuracy" name="Avg Accuracy" barSize={40}>
                            {modelCompData.map((_, i) => (
                              <Cell key={i} fill={getColor(i)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-12">No model comparison data</p>
                    )}
                  </Card>
                </div>

                {/* Training Efficiency */}
                <Card title="Training Efficiency (Epochs vs Best Validation Accuracy)">
                  {efficiencyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" name="Epochs" type="number" label={{ value: 'Number of Epochs', position: 'insideBottom', offset: -10 }} />
                        <YAxis dataKey="y" name="Best Val Accuracy" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                        <RechartsTooltip
                          formatter={(val, name) => {
                            if (name === 'Best Val Accuracy') return `${(val * 100).toFixed(1)}%`;
                            return val;
                          }}
                          labelFormatter={() => ''}
                        />
                        <Scatter name="Sessions" data={efficiencyData} fill="#2563eb">
                          {efficiencyData.map((_, i) => (
                            <Cell key={i} fill={getColor(i)} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">No training data available</p>
                  )}
                </Card>
              </>
            )}

            {!isPerfLoading && !perfData && selectedStudyId && (
              <Card>
                <p className="text-sm text-gray-400 text-center py-12">No performance data found for this study</p>
              </Card>
            )}
          </>
        )}

        {/* ===== COMPARE STUDIES TAB ===== */}
        {activeTab === 'compare' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Study selector */}
              <Card title="Select Studies to Compare" className="lg:col-span-1">
                <div className="space-y-3">
                  {/* Select All */}
                  <div className="flex items-center gap-3 pb-2 border-b border-gray-200">
                    <input
                      type="checkbox"
                      checked={allCompareSelected}
                      ref={(el) => { if (el) el.indeterminate = someCompareSelected; }}
                      onChange={toggleCompareAll}
                      className={theme.classes.checkbox}
                    />
                    <span className="text-sm font-medium text-gray-700">Select All</span>
                    {selectedCompareIds.length > 0 && (
                      <span className="text-xs text-gray-400">{selectedCompareIds.length} selected</span>
                    )}
                  </div>

                  {/* Study list */}
                  <div className="max-h-80 overflow-y-auto space-y-1">
                    {allStudies.map((study) => (
                      <label
                        key={study.id}
                        className={`flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                          selectedCompareIds.includes(study.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCompareIds.includes(study.id)}
                          onChange={() => toggleCompareStudy(study.id)}
                          className={theme.classes.checkbox}
                        />
                        <span className="text-sm text-gray-900 truncate">{study.name}</span>
                      </label>
                    ))}
                  </div>

                  {/* Compare button */}
                  <button
                    type="button"
                    disabled={selectedCompareIds.length < 2}
                    onClick={fetchCompare}
                    className={`w-full mt-3 ${selectedCompareIds.length >= 2 ? theme.classes.btnPrimary : theme.classes.btnDisabled}`}
                  >
                    {isCompareLoading ? 'Loading...' : `Compare ${selectedCompareIds.length} Studies`}
                  </button>
                  {selectedCompareIds.length < 2 && selectedCompareIds.length > 0 && (
                    <p className="text-xs text-gray-400 text-center">Select at least 2 studies</p>
                  )}
                </div>
              </Card>

              {/* Comparison bar chart */}
              <Card title="Accuracy & Confidence Comparison" className="lg:col-span-2">
                {compareBarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(320, compareBarData.length * 45)}>
                    <BarChart data={compareBarData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        formatter={(v) => `${v}%`}
                        labelFormatter={(label) => {
                          const item = compareBarData.find(d => d.name === label);
                          return item?.fullName || label;
                        }}
                      />
                      <Legend />
                      <Bar dataKey="Avg Accuracy" fill="#2563eb" barSize={14} />
                      <Bar dataKey="Avg Confidence" fill="#16a34a" barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-12">Select studies and click Compare to see results</p>
                )}
              </Card>
            </div>

            {/* Comparison table */}
            {sortedCompareData.length > 0 && (
              <Card title="Study Comparison Details">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {[
                          { key: 'study_name', label: 'Study' },
                          { key: 'total_sessions', label: 'Sessions' },
                          { key: 'total_tests', label: 'Tests' },
                          { key: 'avg_sample_size', label: 'Avg Samples/Class' },
                          { key: 'best_accuracy', label: 'Best Accuracy' },
                          { key: 'avg_accuracy', label: 'Avg Accuracy' },
                          { key: 'avg_confidence', label: 'Avg Confidence' },
                          { key: 'models_used', label: 'Models' },
                        ].map((col) => (
                          <th
                            key={col.key}
                            className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 cursor-pointer select-none hover:text-blue-600"
                            onClick={() => handleCompareSort(col.key)}
                          >
                            {col.label}{compareSortArrow(col.key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedCompareData.map((row, i) => (
                        <tr key={row.study_id} className="hover:bg-blue-50 transition-colors">
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-blue-600 font-medium">{row.study_name}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 tabular-nums">{row.total_sessions}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 tabular-nums">{row.total_tests}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 tabular-nums">{row.avg_sample_size}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium tabular-nums">
                            {row.best_accuracy ? `${(row.best_accuracy * 100).toFixed(1)}%` : '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium tabular-nums">
                            {row.avg_accuracy ? `${(row.avg_accuracy * 100).toFixed(1)}%` : '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 tabular-nums">
                            {row.avg_confidence ? `${(row.avg_confidence * 100).toFixed(1)}%` : '-'}
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-500">
                            {(row.models_used || []).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Accuracy vs Sample Size scatter (cross-study) */}
            {sortedCompareData.length > 0 && (
              <Card title="Accuracy vs Average Sample Size">
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" name="Avg Samples/Class" type="number" label={{ value: 'Avg Samples per Class', position: 'insideBottom', offset: -10 }} />
                    <YAxis dataKey="y" name="Avg Accuracy" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <RechartsTooltip
                      formatter={(val, name) => {
                        if (name === 'Avg Accuracy') return `${(val * 100).toFixed(1)}%`;
                        return val;
                      }}
                    />
                    <Legend />
                    {sortedCompareData.map((study, i) => (
                      <Scatter
                        key={study.study_id}
                        name={study.study_name.length > 20 ? study.study_name.slice(0, 20) + '...' : study.study_name}
                        data={[{ x: study.avg_sample_size, y: study.avg_accuracy }]}
                        fill={getColor(i)}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
