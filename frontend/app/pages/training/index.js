import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import AddSession from '../../components/addTrainingSession';
import { getStatusColor } from '../../utils';

export default function Training() {
  const [sessions, setSessions] = useState([]); 
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddSession, setIsOpenAddSession] = useState(false);
  const [refresh, setRefresh] = useState(false);

  useEffect(() => {
    let intervalId;

    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/feature_extractor/trainingsession/');
        const data = await response.json();
        if (Array.isArray(data)) {
          console.log('Data:', data);
          setSessions(data);
        } else {
          throw new Error('Data is not an array');
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
        setIsLoading(false);
        // Set sessions to an empty array in case of an error
        setSessions([]);
      }
    };
    

    fetchSessions();

    // Set up an interval to refresh session data every x seconds
    const refreshInterval = 5000; 
    intervalId = setInterval(fetchSessions, refreshInterval);

    // Clean up the interval on component unmount
    return () => clearInterval(intervalId);
  }, [refresh]); 

  const handleClose = () => {
    setIsOpenAddSession(false);
    setRefresh((prevRefresh) => !prevRefresh);  
  };

  const incomingAction = (incomingActionFromParent) => {
    setIsOpenAddSession(incomingActionFromParent);
  };

  return (
    <Layout incomingAction={incomingAction} action={'New Training Session'}>
      { isOpenAddSession && <AddSession isOpen={isOpenAddSession} onClose={handleClose} /> } 
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Training Sessions</h1>
            <p className="mt-2 text-sm text-gray-700">
              View the status of the last training sessions.
            </p>
          </div>
        </div>
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Session Name
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Date /Time
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Model
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Dataset
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sessions?.map((session) => (
                      <tr key={session.id}>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                          {session.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          {new Date(session.created_at).toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                          {session.model.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">
                          {session.dataset.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                          <span style={{ color: getStatusColor(session.status) }}>
                            {session.status}
                          </span>          
                        </td>
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
