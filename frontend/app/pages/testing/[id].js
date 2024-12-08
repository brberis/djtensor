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
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';
import Tooltip from '../../components/Tooltip'; // Import Tooltip component

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
  const [resultCounts, setResultCounts] = useState({
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  });


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
          
          if (filter.resultType === 'TruePositive') {
            return isTruePositive;
          } else if (filter.resultType === 'FalsePositive') {
            return isFalsePositive;
          } else if (filter.resultType === 'FalseNegative') {
            return isFalseNegative;
          } else if (filter.resultType === 'TrueNegative') {
            return isTrueNegative;
          }
          return true;
        });
      }
  
      setFilteredResults(filtered);
  
      const accuracy = calculateAccuracy(filtered);
      const averageConfidence = calculateAverageConfidence(filtered);
      const confusionMatrixData = calculateConfusionMatrix(filtered);
      const precision = calculatePrecision(confusionMatrixData);
      const recall = calculateRecall(confusionMatrixData);
      const f1Score = calculateF1Score(precision, recall);
      const specificity = calculateSpecificity(confusionMatrixData);
  
      setAccuracy(accuracy);
      setAverageConfidence(averageConfidence);
      setConfusionMatrix(confusionMatrixData);
      setPrecision(precision);
      setRecall(recall);
      setF1Score(f1Score);
      setSpecificity(specificity);
    }
  }, [filter, testResults]);
  
  
  function handleFilterChange(e) {
    const { name, value } = e.target;
  
    if (name === 'species') {
      // Reset the resultType when species changes
      setFilter({
        species: value,
        resultType: 'All',  
      });
    } else {
      setFilter(prevState => ({
        ...prevState,
        [name]: value,
      }));
    }
  }
  
  const calculateCounts = (results) => {
    const counts = {
      truePositive: 0,
      trueNegative: 0,
      falsePositive: 0,
      falseNegative: 0,
    };
  
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
    setFilter(prevState => ({
      ...prevState,
      [name]: value,
    }));
  }

  function formatLabel(label) {
    return label.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  if (isLoading) {
    return <Spinner />;
  }

  if (!test || !(filteredResults?.length > 0)) {
    return (
      <Layout>
        <div className="px-40 sm:px-6 lg:px-8">
          <p>No test data found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-40 sm:px-6 lg:px-8">
        <h1 className="text-lg font-semibold leading-6 text-gray-900">Test Detail</h1>
        <h2 className="text-md mt-2 text-indigo-600">Dataset: {dataset?.name}</h2>
        <h2 className="text-md text-indigo-600">Training Session: {trainingSession?.name}</h2>
        <div className="flex space-x-4 mt-4">
          <div>
            <label htmlFor="species" className="block text-sm font-medium text-gray-700">
              Filter by Species
            </label>
            <select
              id="species"
              name="species"
              value={filter.species}
              onChange={handleFilterChange}
              className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="All">All Species</option>
              {confusionMatrix?.labels.map(label => (
                <option key={label} value={label}>
                  {formatLabel(label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="resultType" className="block text-sm font-medium text-gray-700">
              Filter by Result Type
            </label>
            <select
              id="resultType"
              name="resultType"
              value={filter.resultType}
              onChange={handleFilterChange}
              className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="All">All Results</option>
              <option value="TruePositive">True Positive ({resultCounts.truePositive})</option>
              <option value="TrueNegative">True Negative ({resultCounts.trueNegative})</option>
              <option value="FalsePositive">False Positive ({resultCounts.falsePositive})</option>
              <option value="FalseNegative">False Negative ({resultCounts.falseNegative})</option>
            </select>
          </div>
        </div>
        <div className="mt-4">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Results</h3>

          <p className="flex items-center">
            Accuracy: {accuracy ? `${accuracy.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="Accuracy is the proportion of true results (both true positives and true negatives) among the total number of cases examined." />
          </p>
          <p className="flex items-center">
            Average Confidence: {averageConfidence ? `${averageConfidence.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="Average Confidence represents the average of the confidence scores of all predictions made by the model." />
          </p>
          <p className="flex items-center">
            Precision: {precision !== null ? `${precision.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="Precision is the ratio of correctly predicted positive observations to the total predicted positives." />
          </p>
          <p className="flex items-center">
            Recall: {recall !== null ? `${recall.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="Recall is the ratio of correctly predicted positive observations to all observations in actual class." />
          </p>
          <p className="flex items-center">
            F1 Score: {f1Score !== null ? `${f1Score.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="F1 Score is the weighted average of Precision and Recall." />
          </p>
          <p className="flex items-center">
            Specificity: {specificity !== null ? `${specificity.toFixed(2)}%` : 'Calculating...'}
            <Tooltip text="Specificity is the proportion of actual negatives that are correctly identified as such." />
          </p>
        </div>
        <div className="my-10">
          {confusionMatrix && (
            <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Confusion Matrix</h3>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actual \ Predicted</th>
                    {confusionMatrix.labels.map(label => (
                      <th key={label} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{formatLabel(label)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {confusionMatrix.labels.map((label, rowIndex) => (
                    <tr key={label}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{formatLabel(label)}</td>
                      {confusionMatrix.matrix[rowIndex].map((value, colIndex) => (
                        <td key={colIndex} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="mt-8">
          {filteredResults?.length > 0 ? filteredResults.map(result => (
            <div key={result.id} className="bg-white shadow overflow-hidden sm:rounded-lg p-4 mb-4">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Prediction: {formatLabel(result.prediction)}</h3>
                <h3 className="text-md leading-6 font-medium text-gray-900">True Label: {formatLabel(result.true_label)}</h3>
                <p className="text-md text-gray-800">Confidence: {(result.confidence * 100).toFixed(2)}%</p>
              </div>
              <div className="mx-4">
                <img src={result.grad_cam} alt="Grad cam" className="" />
              </div>
            </div>
          )) : (
            <p>No results available.</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
