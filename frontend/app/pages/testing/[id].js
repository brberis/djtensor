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
import { Fragment, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';
import Tooltip from '../../components/Tooltip';
import theme from '../../theme';

export default function TestDetail() {
  const [test, setTest] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [confusionMatrix, setConfusionMatrix] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataset, setDataset] = useState(null);
  const [trainingSession, setTrainingSession] = useState(null);
  const router = useRouter();
  const { id } = router.query;
  const [accuracy, setAccuracy] = useState(null);
  const [averageConfidence, setAverageConfidence] = useState(null);
  const [precision, setPrecision] = useState(null);
  const [recall, setRecall] = useState(null);
  const [f1Score, setF1Score] = useState(null);
  const [specificity, setSpecificity] = useState(null);
  const [filter, setFilter] = useState({ species: 'All', minConfidence: 0 });
  const [filteredResults, setFilteredResults] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedImage, setSelectedImage] = useState(null);
  const [resultCounts, setResultCounts] = useState({
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  });

  const PAGE_SIZE = 24;

  const normalizeMediaUrl = (value) => {
    if (!value) return null;
    if (value.startsWith("http") || value.startsWith("/")) return value;
    return "/media/" + value;
  };

  const totalPages = Math.max(1, Math.ceil((filteredResults?.length || 0) / PAGE_SIZE));
  const pageStartIndex = (currentPage - 1) * PAGE_SIZE;
  const pageEndIndex = Math.min(pageStartIndex + PAGE_SIZE, filteredResults.length);
  const pagedResults = filteredResults.slice(pageStartIndex, pageEndIndex);


  function calculateAccuracy(results) {
    const correct = results.filter(result => result.prediction === result.true_label).length;
    return (correct / results.length) * 100;
  }

  function calculateAverageConfidence(results) {
    const totalConfidence = results.reduce((sum, result) => sum + result.confidence, 0);
    return (totalConfidence / results.length) * 100;
  }

  function calculatePrecision(confusionMatrix) {
    const { labels, matrix } = confusionMatrix;
    const precisionPerClass = labels.map((label, i) => {
      const truePositives = matrix[i][i];
      const predictedPositives = matrix.reduce((sum, row) => sum + row[i], 0);
      return predictedPositives === 0 ? 0 : (truePositives / predictedPositives) * 100;
    });
    return precisionPerClass.reduce((sum, value) => sum + value, 0) / labels.length;
  }

  function calculateRecall(confusionMatrix) {
    const { labels, matrix } = confusionMatrix;
    const recallPerClass = labels.map((label, i) => {
      const truePositives = matrix[i][i];
      const actualPositives = matrix[i].reduce((sum, value) => sum + value, 0);
      return actualPositives === 0 ? 0 : (truePositives / actualPositives) * 100;
    });
    return recallPerClass.reduce((sum, value) => sum + value, 0) / labels.length;
  }

  function calculateF1Score(precision, recall) {
    return (2 * (precision * recall)) / (precision + recall);
  }

  function calculateSpecificity(confusionMatrix) {
    const { labels, matrix } = confusionMatrix;
    const specificityPerClass = labels.map((label, i) => {
      const trueNegatives = matrix.reduce((sum, row, rowIndex) => sum + row.reduce((rowSum, value, colIndex) => rowIndex !== i && colIndex !== i ? rowSum + value : rowSum, 0), 0);
      const actualNegatives = matrix.reduce((sum, row) => sum + row.reduce((rowSum, value, colIndex) => colIndex !== i ? rowSum + value : rowSum, 0), 0);
      return actualNegatives === 0 ? 0 : (trueNegatives / actualNegatives) * 100;
    });
    return specificityPerClass.reduce((sum, value) => sum + value, 0) / labels.length;
  }

  function calculateConfusionMatrix(results) {
    const labels = Array.from(new Set(results.map(result => result.true_label).concat(results.map(result => result.prediction))));
    const matrix = Array.from({ length: labels.length }, () => Array(labels.length).fill(0));

    results.forEach(result => {
      const trueIndex = labels.indexOf(result.true_label);
      const predIndex = labels.indexOf(result.prediction);
      matrix[trueIndex][predIndex]++;
    });

    return { labels, matrix };
  }

  useEffect(() => {
    setCurrentPage(1);
  }, [filter.species, filter.minConfidence]);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        const testResponse = await fetch(`/api/feature_extractor/tests/${id}`);
        const testData = await testResponse.json();
        const datasetResponse = await fetch(`/api/datasets/dataset/${testData.dataset}`);
        const datasetData = await datasetResponse.json();
        const trainingSessionResponse = await fetch(`/api/feature_extractor/trainingsession/${testData.training_session.id}`);
        const trainingSessionData = await trainingSessionResponse.json();
        const resultsResponse = await fetch(`/api/feature_extractor/testresults/?test__id=${testData.id}`);
        const resultsData = await resultsResponse.json();

        if (resultsData) {
          setTestResults(resultsData);
          setFilteredResults(resultsData);
        } else {
          setTestResults([]);
          setFilteredResults([]);
        }

        setTest(testData);
        setDataset(datasetData);
        setTrainingSession(trainingSessionData);
      } catch (error) {
        console.error('Failed to load test data or results:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [id]);

  useEffect(() => {
    if (testResults.length > 0) {
      const filteredBySpecies = testResults.filter(result => filter.species === 'All' || result.true_label === filter.species);

      const counts = calculateCounts(filteredBySpecies);
      setResultCounts(counts);

      let filtered = filteredBySpecies;

      if (filter.resultType && filter.resultType !== 'All') {
        filtered = filtered.filter(result => {
          const isTruePositive = result.true_label === result.prediction && result.confidence > 0.5;
          const isFalsePositive = result.prediction !== result.true_label && result.confidence > 0.5;
          const isFalseNegative = result.prediction !== result.true_label && result.confidence <= 0.5;
          const isTrueNegative = result.true_label !== result.prediction && result.confidence > 0.5;

          if (filter.resultType === 'TruePositive') return isTruePositive;
          if (filter.resultType === 'FalsePositive') return isFalsePositive;
          if (filter.resultType === 'FalseNegative') return isFalseNegative;
          if (filter.resultType === 'TrueNegative') return isTrueNegative;
          return true;
        });
      }

      setFilteredResults(filtered);

      const acc = calculateAccuracy(filtered);
      const avgConf = calculateAverageConfidence(filtered);
      const confMatrix = calculateConfusionMatrix(filtered);
      const prec = calculatePrecision(confMatrix);
      const rec = calculateRecall(confMatrix);
      const f1 = calculateF1Score(prec, rec);
      const spec = calculateSpecificity(confMatrix);

      setAccuracy(acc);
      setAverageConfidence(avgConf);
      setConfusionMatrix(confMatrix);
      setPrecision(prec);
      setRecall(rec);
      setF1Score(f1);
      setSpecificity(spec);
    }
  }, [filter, testResults]);

  const calculateCounts = (results) => {
    const counts = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    results.forEach(result => {
      const isTruePositive = result.true_label === result.prediction && result.confidence > 0.5;
      const isFalsePositive = result.prediction !== result.true_label && result.confidence > 0.5;
      const isFalseNegative = result.prediction !== result.true_label && result.confidence <= 0.5;
      const isTrueNegative = result.true_label !== result.prediction && result.confidence > 0.5;

      if (isTruePositive) counts.truePositive++;
      if (isTrueNegative) counts.trueNegative++;
      if (isFalsePositive) counts.falsePositive++;
      if (isFalseNegative) counts.falseNegative++;
    });
    return counts;
  };

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilter(prevState => ({ ...prevState, [name]: value }));
  }

  function formatLabel(label) {
    return label.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  if (isLoading) {
    return (
      <Layout>
        <Spinner />
      

      <Transition.Root show={!!selectedImage} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setSelectedImage(null)}>
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
            <div className="flex min-h-full items-end justify-center text-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden bg-white text-left shadow-xl transition-all w-full sm:rounded-lg sm:my-8 sm:max-w-5xl">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <Dialog.Title as="h3" className="text-sm font-semibold text-gray-900">
                      {selectedImage?.title || "Image"}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setSelectedImage(null)}
                      className="rounded-md p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-gray-50">
                    {selectedImage?.src && (
                      <img
                        src={selectedImage.src}
                        alt={selectedImage.title || "Image"}
                        className="w-full max-h-[80vh] object-contain"
                      />
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

    </Layout>
    );
  }

  if (!test || !(filteredResults?.length > 0)) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-sm text-gray-500">No test data found.</p>
        </div>
      

      <Transition.Root show={!!selectedImage} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setSelectedImage(null)}>
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
            <div className="flex min-h-full items-end justify-center text-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden bg-white text-left shadow-xl transition-all w-full sm:rounded-lg sm:my-8 sm:max-w-5xl">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <Dialog.Title as="h3" className="text-sm font-semibold text-gray-900">
                      {selectedImage?.title || "Image"}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setSelectedImage(null)}
                      className="rounded-md p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-gray-50">
                    {selectedImage?.src && (
                      <img
                        src={selectedImage.src}
                        alt={selectedImage.title || "Image"}
                        className="w-full max-h-[80vh] object-contain"
                      />
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

    </Layout>
    );
  }

  // Metric card helper
  const MetricCard = ({ label, value, tooltip }) => (
    <div className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl px-4 py-4">
      <div className="flex items-center gap-x-1">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
        {value !== null ? `${value.toFixed(2)}%` : '...'}
      </p>
    </div>
  );

  return (
    <Layout>
      {/* Breadcrumb & header */}
      <div className="mb-6">
        <div className="flex items-center gap-x-3">
          <button onClick={() => router.push('/testing')} className="text-sm text-gray-500 hover:text-gray-700">
            Tests
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-900">{test.name}</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">{test.name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-6 text-sm text-gray-500">
          <span>Dataset: <span className="font-medium text-blue-600">{dataset?.name}</span></span>
          <span>Training: <span className="font-medium text-blue-600">{trainingSession?.name}</span></span>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="min-w-[200px]">
          <label htmlFor="species" className={theme.classes.label}>Filter by Species</label>
          <select
            id="species"
            name="species"
            value={filter.species}
            onChange={handleFilterChange}
            className={`mt-1 ${theme.classes.select}`}
          >
            <option value="All">All Species</option>
            {confusionMatrix?.labels.map(label => (
              <option key={label} value={label}>{formatLabel(label)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label htmlFor="resultType" className={theme.classes.label}>Filter by Result Type</label>
          <select
            id="resultType"
            name="resultType"
            value={filter.resultType}
            onChange={handleFilterChange}
            className={`mt-1 ${theme.classes.select}`}
          >
            <option value="All">All Results</option>
            <option value="TruePositive">True Positive ({resultCounts.truePositive})</option>
            <option value="TrueNegative">True Negative ({resultCounts.trueNegative})</option>
            <option value="FalsePositive">False Positive ({resultCounts.falsePositive})</option>
            <option value="FalseNegative">False Negative ({resultCounts.falseNegative})</option>
          </select>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <MetricCard label="Accuracy" value={accuracy}
          tooltip="Proportion of true results among the total number of cases examined." />
        <MetricCard label="Avg Confidence" value={averageConfidence}
          tooltip="Average confidence score across all predictions made by the model." />
        <MetricCard label="Precision" value={precision}
          tooltip="Ratio of correctly predicted positive observations to total predicted positives." />
        <MetricCard label="Recall" value={recall}
          tooltip="Ratio of correctly predicted positive observations to all actual positives." />
        <MetricCard label="F1 Score" value={f1Score}
          tooltip="Weighted average of Precision and Recall." />
        <MetricCard label="Specificity" value={specificity}
          tooltip="Proportion of actual negatives correctly identified as such." />
      </div>

      {/* Confusion Matrix */}
      {confusionMatrix && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Confusion Matrix</h2>
          <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actual / Predicted
                  </th>
                  {confusionMatrix.labels.map(label => (
                    <th key={label} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {formatLabel(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {confusionMatrix.labels.map((label, rowIndex) => (
                  <tr key={label}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatLabel(label)}</td>
                    {confusionMatrix.matrix[rowIndex].map((value, colIndex) => (
                      <td
                        key={colIndex}
                        className={`px-4 py-3 text-sm font-mono ${rowIndex === colIndex ? 'font-bold text-blue-700 bg-blue-50' : 'text-gray-500'}`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual results */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Prediction Results ({filteredResults?.length})
        </h2>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
          <p className="text-sm text-gray-500">
            Showing <span className="font-medium text-gray-700">{filteredResults.length === 0 ? 0 : pageStartIndex + 1}</span>
            to
            <span className="font-medium text-gray-700">{pageEndIndex}</span>
            of
            <span className="font-medium text-gray-700">{filteredResults.length}</span>
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset ring-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-sm text-gray-500">Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset ring-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredResults?.length > 0 ? pagedResults.map(result => {
            const isCorrect = result.prediction === result.true_label;
            return (
              <div key={result.id} className="bg-white shadow-sm ring-1 ring-gray-900/5 rounded-xl overflow-hidden">
                {result.grad_cam && (() => {
                  const src = normalizeMediaUrl(result.grad_cam);
                  if (!src) return null;

                  const title = "Grad-CAM - " + formatLabel(result.prediction);

                  return (
                    <button
                      type="button"
                      onClick={() => setSelectedImage({ src, title })}
                      className="block w-full focus:outline-none"
                      aria-label="Open Grad-CAM image"
                    >
                      <img src={src} alt="Grad-CAM visualization" className="w-full h-48 object-contain bg-gray-50 hover:bg-gray-100" />
                    </button>
                  );
                })()}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${isCorrect ? 'bg-green-50 text-green-700 ring-green-600/20' : 'bg-red-50 text-red-700 ring-red-600/10'}`}>
                      {isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                    <span className="text-sm font-mono text-gray-500">
                      {(result.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-sm text-gray-900">
                    <span className="font-medium">Predicted:</span> {formatLabel(result.prediction)}
                  </p>
                  <p className="text-sm text-gray-500">
                    <span className="font-medium">Actual:</span> {formatLabel(result.true_label)}
                  </p>
                </div>
              </div>
            );
          }) : (
            <p className="text-sm text-gray-500 col-span-full">No results available.</p>
          )}
        </div>
      </div>
    

      <Transition.Root show={!!selectedImage} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setSelectedImage(null)}>
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
            <div className="flex min-h-full items-end justify-center text-center sm:items-center sm:p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 translate-y-4 sm:scale-95"
                enterTo="opacity-100 translate-y-0 sm:scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                leaveTo="opacity-0 translate-y-4 sm:scale-95"
              >
                <Dialog.Panel className="relative transform overflow-hidden bg-white text-left shadow-xl transition-all w-full sm:rounded-lg sm:my-8 sm:max-w-5xl">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <Dialog.Title as="h3" className="text-sm font-semibold text-gray-900">
                      {selectedImage?.title || "Image"}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setSelectedImage(null)}
                      className="rounded-md p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="bg-gray-50">
                    {selectedImage?.src && (
                      <img
                        src={selectedImage.src}
                        alt={selectedImage.title || "Image"}
                        className="w-full max-h-[80vh] object-contain"
                      />
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition.Root>

    </Layout>
  );
}
