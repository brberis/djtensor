import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { Line } from 'react-chartjs-2';
import Spinner from '../../components/Spinner';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export default function TrainingDetail() {
  const [session, setSession] = useState(null);
  const [epochs, setEpochs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { id } = router.query;



// Calculate max and min for loss
const maxLoss = Math.max(...epochs.map(epoch => Math.max(epoch.loss, epoch.val_loss)));
const minLoss = Math.min(...epochs.map(epoch => Math.min(epoch.loss, epoch.val_loss)));

// Calculate max and min for accuracy
const maxAccuracy = Math.max(...epochs.map(epoch => Math.max(epoch.accuracy, epoch.val_accuracy)));
const minAccuracy = Math.min(...epochs.map(epoch => Math.min(epoch.accuracy, epoch.val_accuracy)));

const lossData = {
  labels: epochs.map((_, index) => index + 1),
  datasets: [
    {
      label: 'Training Loss',
      data: epochs.map(epoch => epoch.loss),
      borderColor: 'rgb(255, 99, 132)',
      backgroundColor: 'rgba(255, 99, 132, 0.5)',
    },
    {
      label: 'Validation Loss',
      data: epochs.map(epoch => epoch.val_loss),
      borderColor: 'rgb(53, 162, 235)',
      backgroundColor: 'rgba(53, 162, 235, 0.5)',
    }
  ],
};

const accuracyData = {
  labels: epochs.map((_, index) => index + 1),
  datasets: [
    {
      label: 'Training Accuracy',
      data: epochs.map(epoch => epoch.accuracy),
      borderColor: 'rgb(255, 99, 132)',
      backgroundColor: 'rgba(255, 99, 132, 0.5)',
    },
    {
      label: 'Validation Accuracy',
      data: epochs.map(epoch => epoch.val_accuracy),
      borderColor: 'rgb(53, 162, 235)',
      backgroundColor: 'rgba(53, 162, 235, 0.5)',
    }
  ],
};

const lossOptions = {
  scales: {
    y: { 
      beginAtZero: false,
      suggestedMin: minLoss - 0.1 * Math.abs(minLoss),  // 10% padding below min
      suggestedMax: maxLoss + 0.1 * maxLoss  // 10% padding above max
    }
  },
  responsive: true,
  plugins: {
    legend: {
      position: 'top',
    },
    title: {
      display: true,
      text: 'Loss (Training and Validation)'
    },
  }
};

const accuracyOptions = {
  scales: {
    y: {
      beginAtZero: false,
      suggestedMin: minAccuracy - 0.1 * minAccuracy,  // 10% padding below min
      suggestedMax: maxAccuracy + 0.1 * maxAccuracy  // 10% padding above max
    }
  },
  responsive: true,
  plugins: {
    legend: {
      position: 'top',
    },
    title: {
      display: true,
      text: 'Accuracy (Training and Validation)'
    },
  }
};


  useEffect(() => {
    const fetchSession = async () => {
      if (!id) return;
      setIsLoading(true);
      try {
        const sessionResponse = await fetch(`/api/feature_extractor/trainingsession/${id}`);
        const sessionData = await sessionResponse.json();
        setSession(sessionData);

        const epochsResponse = await fetch(`/api/feature_extractor/epoch/?training_session=${id}`);
        const epochsData = await epochsResponse.json();
        setEpochs(epochsData);
        console.log('Epochs:', epochsData);
      } catch (error) {
        console.error('Failed to fetch session or epochs:', error);
      }
      setIsLoading(false);
    };

    fetchSession();
  }, [id]);


  if (isLoading) {
    return  <Spinner />;
  }

  if (!session) {
    return <p>No session data found.</p>;
  }

  return (
    <Layout>
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Training Session Detail</h1>
            <p className="mt-2 text-sm text-gray-700">
              Detailed information about the training session including dataset and model used.
            </p>
          </div>
        </div>
        <div className="mt-8">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Session: {session.name}</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Notes: {session.notes || "N/A"}</p>
            </div>
            <div className="border-t border-gray-200">
              <dl>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Training Date</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    {new Date(session.created_at).toLocaleDateString("en-US", {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true
                    })}
                  </dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.status}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Model Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.name}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Dataset Name</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.dataset.name}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Resolution</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.dataset.resolution}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Epochs</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.epochs}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Validation Split</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.validation_split}</dd>
                </div>
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Batch Size</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.model.batch_size}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
        <div>
        <Line data={lossData} options={lossOptions} />

        <Line data={accuracyData} options={accuracyOptions} />

        </div>
        <div className="mt-8">
          <h2 className="text-lg leading-6 font-medium text-gray-900">Training Epochs</h2>
          <div className="mt-4">
            {epochs.length ? (
              epochs.map(epoch => (
                <div key={epoch.number} className="bg-white shadow overflow-hidden sm:rounded-lg p-4 mb-4">
                  <p><strong>Epoch Number:</strong> {epoch.number}</p>
                  <p><strong>Accuracy:</strong> {epoch.accuracy}</p>
                  <p><strong>Loss:</strong> {epoch.loss}</p>
                  <p><strong>Validation Accuracy:</strong> {epoch.val_accuracy}</p>
                  <p><strong>Validation Loss:</strong> {epoch.val_loss}</p>
                </div>
              ))
            ) : (
              <p>No epochs data available.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
