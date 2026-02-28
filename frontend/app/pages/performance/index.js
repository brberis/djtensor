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
  Legend, ResponsiveContainer, BarChart, Bar, Cell, LineChart, Line,
} from 'recharts';

const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#be185d', '#4d7c0f', '#b45309', '#6d28d9',
];

function getColor(idx) {
  return COLORS[idx % COLORS.length];
}

// Extract T-N number from test name for sorting
function extractTestNumber(name) {
  const match = name.match(/T-(\d+)/i);
  return match ? parseInt(match[1], 10) : 9999;
}

// Card wrapper
function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl p-6 ${className}`}>
      {title && <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

// Stat card
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
  const [sortCol, setSortCol] = useState(null); // null = natural T-N order
  const [sortDir, setSortDir] = useState('asc');

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

    const interval = setInterval(() => {
      const current = localStorage.getItem('selectedStudy');
      if (current && Number(current) !== selectedStudyId) {
        setSelectedStudyId(Number(current));
      }
    }, 500);

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

  // Fetch studies list (for Compare tab)
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

  // -- Study Performance data --

  // Flat rows for cross-session comparison table, sorted by T-N by default
  const tableRows = useMemo(() => {
    if (!perfData) return [];
    const rows = [];
    (perfData.sessions || []).forEach((sess) => {
      const tests = sess.tests || [];
      if (tests.length === 0) {
        rows.push({
          sessionId: sess.session_id,
          sessionName: sess.session_name,
          testName: sess.session_name,
          model: sess.model_name,
          dataset: sess.dataset_name,
          resolution: sess.model_resolution,
          avgImgPerClass: sess.avg_images_per_class,
          accuracy: sess.best_val_accuracy,
          confidence: null,
          f1: null,
          _testNum: extractTestNumber(sess.session_name),
        });
      } else {
        tests.forEach((t) => {
          rows.push({
            sessionId: sess.session_id,
            sessionName: sess.session_name,
            testName: t.test_name,
            model: sess.model_name,
            dataset: sess.dataset_name,
            resolution: sess.model_resolution,
            avgImgPerClass: sess.avg_images_per_class,
            accuracy: t.accuracy,
            confidence: t.avg_confidence,
            f1: t.macro_f1,
            _testNum: extractTestNumber(t.test_name),
          });
        });
      }
    });
    return rows;
  }, [perfData]);

  // Sorted table rows — default by T-N number
  const sortedRows = useMemo(() => {
    const sorted = [...tableRows];
    if (!sortCol) {
      // Default: sort by T-N number
      sorted.sort((a, b) => a._testNum - b._testNum);
    } else {
      sorted.sort((a, b) => {
        const aVal = a[sortCol] ?? -1;
        const bVal = b[sortCol] ?? -1;
        if (typeof aVal === 'string') {
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return sorted;
  }, [tableRows, sortCol, sortDir]);

  // Accuracy per iteration (line chart) — sorted by T-N
  const iterationAccuracyData = useMemo(() => {
    if (!perfData) return [];
    const points = [];
    (perfData.sessions || []).forEach((sess) => {
      (sess.tests || []).forEach((t) => {
        points.push({
          name: t.test_name.replace(/.*?(T-\d+)/, '$1'),
          fullName: t.test_name,
          accuracy: +(t.accuracy * 100).toFixed(1),
          confidence: +(t.avg_confidence * 100).toFixed(1),
          _testNum: extractTestNumber(t.test_name),
        });
      });
    });
    points.sort((a, b) => a._testNum - b._testNum);
    return points;
  }, [perfData]);

  // Aggregated confusion matrix from backend
  const aggConfusionGrid = useMemo(() => {
    if (!perfData || !perfData.aggregated_confusion) return null;
    const { confusion, labels } = perfData.aggregated_confusion;
    if (!labels || labels.length === 0) return null;

    const lookup = {};
    let maxCount = 1;
    confusion.forEach((c) => {
      const key = `${c.true_label}__${c.predicted}`;
      lookup[key] = c.count;
      if (c.count > maxCount) maxCount = c.count;
    });
    return { labels, lookup, maxCount };
  }, [perfData]);

  // Aggregated per-class data
  const aggPerClassData = useMemo(() => {
    if (!perfData || !perfData.aggregated_confusion) return [];
    return (perfData.aggregated_confusion.per_class || []).map((c) => ({
      label: c.label,
      Precision: +(c.precision * 100).toFixed(1),
      Recall: +(c.recall * 100).toFixed(1),
      F1: +(c.f1 * 100).toFixed(1),
    }));
  }, [perfData]);

  // Model comparison — only show if multiple models
  const modelCompData = useMemo(() => {
    if (!perfData || !perfData.model_comparison) return [];
    return perfData.model_comparison.map((m) => ({
      model: m.model_name,
      accuracy: +(m.avg_accuracy * 100).toFixed(1),
      tests: m.num_tests,
    }));
  }, [perfData]);

  const hasMultipleModels = (perfData?.unique_models || []).length > 1;
  const hasVaryingSampleSizes = perfData?.has_varying_sample_sizes || false;

  // -- Compare Studies data --
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

  const compareBarData = useMemo(() => {
    if (!compareData) return [];
    return compareData.map((s) => ({
      name: s.study_name.length > 25 ? s.study_name.slice(0, 25) + '...' : s.study_name,
      fullName: s.study_name,
      'Avg Accuracy': +(s.avg_accuracy * 100).toFixed(1),
      'Avg Confidence': +(s.avg_confidence * 100).toFixed(1),
    }));
  }, [compareData]);

  // Accuracy vs sample size scatter for compare tab
  const compareScatterData = useMemo(() => {
    if (!compareData) return [];
    return compareData.map((s) => ({
      x: s.avg_sample_size,
      y: s.avg_accuracy,
      name: s.study_name,
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
                    sub="Best single test"
                  />
                  <StatCard
                    label="Avg Accuracy"
                    value={`${((perfData.summary?.avg_accuracy ?? 0) * 100).toFixed(1)}%`}
                    sub="Across all tests"
                  />
                </div>

                {/* Accuracy per Iteration (line chart) */}
                {iterationAccuracyData.length > 0 && (
                  <Card title="Accuracy & Confidence per Iteration">
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={iterationAccuracyData} margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip
                          formatter={(val, name) => `${val}%`}
                          labelFormatter={(label) => {
                            const item = iterationAccuracyData.find(d => d.name === label);
                            return item?.fullName || label;
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="accuracy" name="Accuracy" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="confidence" name="Confidence" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                )}

                {/* Accuracy/Confidence vs Sample Size — only if varying sample sizes */}
                {hasVaryingSampleSizes && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <Card title="Accuracy vs Sample Size">
                      {(() => {
                        const points = [];
                        const modelSet = new Set();
                        (perfData.sessions || []).forEach((sess) => {
                          (sess.tests || []).forEach((t) => {
                            modelSet.add(sess.model_name);
                            points.push({ x: sess.avg_images_per_class, y: t.accuracy, model: sess.model_name });
                          });
                        });
                        const models = [...modelSet];
                        return points.length > 0 ? (
                          <ResponsiveContainer width="100%" height={320}>
                            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="x" name="Avg Images/Class" type="number" label={{ value: 'Avg Images per Class', position: 'insideBottom', offset: -10 }} />
                              <YAxis dataKey="y" name="Accuracy" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                              <RechartsTooltip formatter={(val, name) => name === 'Accuracy' ? `${(val * 100).toFixed(1)}%` : val} />
                              <Legend />
                              {models.map((model, i) => (
                                <Scatter key={model} name={model} data={points.filter((p) => p.model === model)} fill={getColor(i)} />
                              ))}
                            </ScatterChart>
                          </ResponsiveContainer>
                        ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>;
                      })()}
                    </Card>
                    <Card title="Confidence vs Sample Size">
                      {(() => {
                        const points = [];
                        const modelSet = new Set();
                        (perfData.sessions || []).forEach((sess) => {
                          (sess.tests || []).forEach((t) => {
                            modelSet.add(sess.model_name);
                            points.push({ x: sess.avg_images_per_class, y: t.avg_confidence, model: sess.model_name });
                          });
                        });
                        const models = [...modelSet];
                        return points.length > 0 ? (
                          <ResponsiveContainer width="100%" height={320}>
                            <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="x" name="Avg Images/Class" type="number" label={{ value: 'Avg Images per Class', position: 'insideBottom', offset: -10 }} />
                              <YAxis dataKey="y" name="Confidence" type="number" domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                              <RechartsTooltip formatter={(val, name) => name === 'Confidence' ? `${(val * 100).toFixed(1)}%` : val} />
                              <Legend />
                              {models.map((model, i) => (
                                <Scatter key={model} name={model} data={points.filter((p) => p.model === model)} fill={getColor(i)} />
                              ))}
                            </ScatterChart>
                          </ResponsiveContainer>
                        ) : <p className="text-sm text-gray-400 text-center py-12">No data</p>;
                      })()}
                    </Card>
                  </div>
                )}

                {/* Aggregated Confusion Matrix + Per-Class Performance side by side */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <Card title="Aggregated Confusion Matrix">
                    <p className="text-xs text-gray-400 mb-3">Combined across all {perfData.summary?.total_tests ?? 0} tests</p>
                    {aggConfusionGrid ? (
                      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                        <div className="inline-block">
                          <div className="flex">
                            <div className="w-24 h-8 flex items-center justify-center text-xs font-semibold text-gray-500">True \ Pred</div>
                            {aggConfusionGrid.labels.map((label) => (
                              <div key={label} className="w-16 h-8 flex items-center justify-center text-xs font-medium text-gray-700 truncate" title={label}>
                                {label.length > 6 ? label.slice(0, 6) + '..' : label}
                              </div>
                            ))}
                          </div>
                          {aggConfusionGrid.labels.map((trueLabel) => (
                            <div key={trueLabel} className="flex">
                              <div className="w-24 h-12 flex items-center justify-end pr-2 text-xs font-medium text-gray-700 truncate" title={trueLabel}>
                                {trueLabel.length > 10 ? trueLabel.slice(0, 10) + '..' : trueLabel}
                              </div>
                              {aggConfusionGrid.labels.map((predLabel) => {
                                const count = aggConfusionGrid.lookup[`${trueLabel}__${predLabel}`] || 0;
                                const intensity = count / aggConfusionGrid.maxCount;
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

                  {/* Per-Class Performance (aggregated) */}
                  <Card title="Per-Class Performance (Aggregated)">
                    {aggPerClassData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={Math.max(300, aggPerClassData.length * 50)}>
                        <BarChart data={aggPerClassData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                          <YAxis dataKey="label" type="category" width={75} tick={{ fontSize: 12 }} />
                          <RechartsTooltip formatter={(v) => `${v}%`} />
                          <Legend />
                          <Bar dataKey="Precision" fill="#2563eb" barSize={12} />
                          <Bar dataKey="Recall" fill="#16a34a" barSize={12} />
                          <Bar dataKey="F1" fill="#d97706" barSize={12} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-12">No per-class data available</p>
                    )}
                  </Card>
                </div>

                {/* Model Architecture Comparison — only if multiple models */}
                {hasMultipleModels && modelCompData.length > 0 && (
                  <Card title="Model Architecture Comparison">
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
                  </Card>
                )}

                {/* Cross-Session Comparison Table */}
                <Card title="Cross-Session Comparison">
                  {sortedRows.length > 0 ? (
                    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                          <tr>
                            {[
                              { key: 'testName', label: 'Test' },
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
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-blue-600 font-medium">{row.testName}</td>
                              <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{row.sessionName}</td>
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
                      {sortedCompareData.map((row) => (
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
            {compareScatterData.length > 0 && (
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
                    {compareScatterData.map((study, i) => (
                      <Scatter
                        key={study.name}
                        name={study.name.length > 20 ? study.name.slice(0, 20) + '...' : study.name}
                        data={[{ x: study.x, y: study.y }]}
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
