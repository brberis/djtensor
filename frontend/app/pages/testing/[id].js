import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';
import Layout from '../../components/Layout';
import Spinner from '../../components/Spinner';

export default function TestDetail() {
  const [test, setTest] = useState(null);
  const [testResults, setTestResults] = useState([]);
  const [confusionMatrix, setConfusionMatrix] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataset, setDataset] = useState(null); 
  const [trainingSession, setTrainingSession] = useState(null);
  // const visRef = useRef(null);
  const router = useRouter();
  const { id } = router.query;
  const [accuracy, setAccuracy] = useState(null);


  function calculateAccuracy(results) {
    const correct = results.filter(result => result.prediction === result.true_label).length;
    return (correct / results.length) * 100;
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
        const trainingSessionResponse = await fetch(`/api/feature_extractor/trainingsession/${testData.training_session}`);
        const trainingSessionData = await trainingSessionResponse.json();
        const resultsResponse = await fetch(`/api/feature_extractor/testresults/?test__id=${testData.id}`);
        const resultsData = await resultsResponse.json();
        console.log('Results:', resultsData);

        if (resultsData) {
          setTestResults(resultsData);
        } else {
          console.error("Results data is missing 'results' key:", resultsData);
          setTestResults([]);  // Ensuring it remains an array
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
      setAccuracy(calculateAccuracy(testResults));
    }
  }, [testResults]);

  function formatLabel(label) {
    return label.replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  // useEffect(() => {
  //   if (!isLoading && confusionMatrix.length) {
  //     const data = { values: confusionMatrix };
  //     tfvis.render.confusionMatrix(visRef.current, data);
  //   }
  // }, [confusionMatrix, isLoading]);

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
          <h3 className="text-lg leading-6 font-medium text-gray-900">Statistics</h3>
          <p>Accuracy: {accuracy ? `${accuracy.toFixed(2)}%` : 'Calculating...'}</p>
        </div>


        <div className="mt-8">
          {testResults?.length > 0 ? testResults.map(result => (
            <div key={result.id} className="bg-white shadow overflow-hidden sm:rounded-lg p-4 mb-4 flex">
              <div className="mr-4">
                <img src={result.image?.image} alt="Test Image" className="w-32 h-32" />
                <p className="text-xs text-gray-500 text-center">{result.image?.label?.name}</p> {/* Label text added here */}
              </div>
              <div>
              <h3 className="text-lg leading-6 font-medium text-gray-900">Prediction: {formatLabel(result.prediction)}</h3>
              <h3 className="text-md leading-6 font-medium text-gray-900">True Label: {formatLabel(result.true_label)}</h3>
                <p className="text-md text-gray-800">Confidence: {result.confidence.toFixed(2) * 100}%</p>
              </div>
            </div>
          )) : (
            <p>No results available.</p>
          )}
        </div>

        <div className="mt-8">
          {/* <div ref={visRef}></div> */}
        </div>
      </div>
    </Layout>
  );
}

