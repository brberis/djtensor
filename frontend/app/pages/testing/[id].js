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
        } else {
          setTestResults([]);  
        }

        setTest(testData);
        setDataset(datasetData);
        setTrainingSession(trainingSessionData);
      } catch (error) {
        console.error('Failed to load test data or results:', error);
      } finally {
        setIsLoading(false);  // Only set this to false here, ensuring all fetches are done
      }
    };

    fetchData();
  }, [id]);

  useEffect(() => {
    if (testResults.length > 0) {
      const accuracy = calculateAccuracy(testResults);
      const averageConfidence = calculateAverageConfidence(testResults);
      const confusionMatrixData = calculateConfusionMatrix(testResults);
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
  }, [testResults]);

  function formatLabel(label) {
    return label.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  if (isLoading) {
    return <Spinner />;
  }

  if (!test || !(testResults?.length > 0)) {
    return <p>No test data found.</p>;
  }

  return (
    <Layout>
      <div className="px-40 sm:px-6 lg:px-8">
        <h1 className="text-lg font-semibold leading-6 text-gray-900">Test Detail</h1>
        <h2 className="text-md mt-2 text-indigo-600">Dataset: {dataset?.name}</h2>
        <h2 className="text-md text-indigo-600">Training Session: {trainingSession?.name}</h2>

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
          {testResults?.length > 0 ? testResults.map(result => (
          <>
            <div key={result.id} className="bg-white shadow overflow-hidden sm:rounded-lg p-4 mb-4">
              {/* <div className="mr-4">
                <img src={result.image?.image} alt="Test Image" className="w-32 h-32" />
                <p className="text-xs text-gray-500 text-center">{result.image?.label?.name}</p> 
              </div>
               */}
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">Prediction: {formatLabel(result.prediction)}</h3>
                <h3 className="text-md leading-6 font-medium text-gray-900">True Label: {formatLabel(result.true_label)}</h3>
                <p className="text-md text-gray-800">Confidence: {(result.confidence * 100).toFixed(2)}%</p>
              </div>
              <div className="mx-4">
              <img src={result.grad_cam} alt="Grad cam" className="" />
            </div> 
            </div>
   
          </>        
          )) : (
            <p>No results available.</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
