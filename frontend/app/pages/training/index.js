import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddSession from '../../components/addTrainingSession';
import { getStatusColor } from '../../utils';

export default function Training() {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddSession, setIsOpenAddSession] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/feature_extractor/trainingsession/');
        const data = await response.json();
        if (Array.isArray(data)) {
          const savedStudy = localStorage.getItem('selectedStudy');
          const filteredData = savedStudy ? data.filter(session => session.study == savedStudy) : data;
          // Sort sessions by created_at in ascending order
          const sortedData = filteredData.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          setSessions(sortedData);
        } else {
          throw new Error('Data is not an array');
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
        setIsLoading(false);
        setSessions([]);
      }
    };

    fetchSessions();
    const refreshInterval = 5000;
    const intervalId = setInterval(fetchSessions, refreshInterval);

    return () => clearInterval(intervalId);
  }, [refresh]);

  const handleSessionClick = (session) => {
    console.log('Attempting to handle click for:', session);
    if (session.status === 'Completed') {
      console.log('Session is completed and clickable');
      router.push(`/training/${session.id}`); 
    }
  };

  const handleClose = () => {
    setIsOpenAddSession(false);
    setRefresh((prevRefresh) => !prevRefresh);
  };

  const incomingAction = (action) => {
    if (action === 'New Training Session') {
      setIsOpenAddSession(true);
    }
  };

  return (
    <Layout incomingAction={incomingAction} action={'New Training Session'}>
      {isOpenAddSession && <AddSession isOpen={isOpenAddSession} onClose={handleClose} />}
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Training Sessions</h1>
            <p className="mt-2 text-sm text-gray-700">View the status of the last training sessions.</p>
          </div>
        </div>
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Session Name</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Date / Time</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Model</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Dataset</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sessions.map((session) => (
                      <tr key={session.id} onClick={() => handleSessionClick(session)} className={session.status === 'Completed' ? 'cursor-pointer hover:bg-gray-50' : ''}>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{session.name}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{new Date(session.created_at).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{session.model.name}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{session.dataset.name}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm" style={{ color: getStatusColor(session.status) }}>{session.status}</td>
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
