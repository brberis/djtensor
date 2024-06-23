import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddTest from '../../components/addTest';
import { getStatusColor } from '../../utils';

export default function Training() {
  const [tests, setTests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddTest, setIsOpenAddTest] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchtests = async () => {
      try {
        const response = await fetch('/api/feature_extractor/tests/');
        const data = await response.json();
        const sortedData = data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (Array.isArray(sortedData)) {
          setTests(sortedData);
        } else {
          throw new Error('Data is not an array');
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch tests:', error);
        setIsLoading(false);
        setTests([]);
      }
    };

    fetchtests();
    const refreshInterval = 5000;
    const intervalId = setInterval(fetchtests, refreshInterval);

    return () => clearInterval(intervalId);
  }, [refresh]);

  const handleTestClick = (test) => {
    console.log('Attempting to handle click for:', test);
    if (test.status === 'Completed') {
      console.log('Test is completed and clickable');
      router.push(`/testing/${test.id}`); 
    }
  };

  const handleClose = () => {
    setIsOpenAddTest(false);
    setRefresh((prevRefresh) => !prevRefresh);
  };

  const incomingAction = (action) => {
    if (action === 'New Test') {
      setIsOpenAddTest(true);
    }
  };

  return (
    <Layout incomingAction={incomingAction} action={'New Test'}>
      {isOpenAddTest && <AddTest isOpen={isOpenAddTest} onClose={handleClose} />}
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Training tests</h1>
            <p className="mt-2 text-sm text-gray-700">View the status of the last training tests.</p>
          </div>
        </div>
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Test Name</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {tests.map((test) => (
                      <tr key={test.id} onClick={() => handleTestClick(test)} className={test.status === 'Completed' ? 'cursor-pointer hover:bg-gray-50' : ''}>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{test.name}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{new Date(test.created_at).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm" style={{ color: getStatusColor(test.status) }}>{test.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
