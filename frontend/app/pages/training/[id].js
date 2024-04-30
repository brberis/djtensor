import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';

export default function TrainingDetail() {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    const fetchSession = async () => {
      if (!id) return; 
      try {
        const response = await fetch(`/api/feature_extractor/trainingsession/${id}`);
        const data = await response.json();
        setSession(data);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch session:', error);
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  if (isLoading) {
    return <p>Loading...</p>;
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
              Detailed information about the training session.
            </p>
          </div>
        </div>
        <div className="mt-8">
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Session: {session.name}</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">{session.description}</p>
            </div>
            <div className="border-t border-gray-200">
              <dl>
                {/* Example of displaying epoch, accuracy, and loss */}
                <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Epoch Accuracy</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.accuracy}</dd>
                </div>
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Epoch Loss</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{session.loss}</dd>
                </div>
                {/* Display additional fields as needed */}
              </dl>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
