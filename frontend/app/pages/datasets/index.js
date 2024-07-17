import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import AddDataset from '../../components/addDataset';
import GenerateDataset from '../../components/generateDataset';

export default function Datasets({ base }) {
  const [datasets, setDatasets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpenAddDataset, setIsOpenAddDataset] = useState(false);
  const [isOpenGenerateDataset, setIsOpenGenerateDataset] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [action, setAction] = useState('');
  const [baseSet, setBaseSet] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const baseDatasets = datasets.filter(dataset => dataset.base);
    if (baseDatasets.length > 0) {
      setBaseSet(true);
    }
  }, [datasets]);

  // Fetch datasets from API
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await fetch('/api/datasets/dataset/');
        const data = await response.json();
        const selectedStudy = localStorage.getItem('selectedStudy'); 
        const filteredDatasets = data.filter(dataset => dataset.study == selectedStudy);

        setDatasets(filteredDatasets);
      } catch (error) {
        console.error('Failed to fetch datasets:', error);
        setDatasets([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDatasets();
  }, [refresh, base]);

  useEffect(() => {
    if (!baseSet) {
      setAction('Create Base Dataset');
    } else {
      setAction('Generate Datasets');
    }
  }, [baseSet]);

  const handleDatasetClick = (dataset) => {
    router.push(`/datasets/${dataset.id}`);
  };

  const handleClose = () => {
    setIsOpenAddDataset(false);
    setRefresh(prev => !prev);
  };

  const incomingAction = async (action) => {
    if (action === 'Create Base Dataset') {
      setIsOpenAddDataset(true);
    }
    if (action === 'Generate Datasets') {
      try {
        setIsOpenGenerateDataset(true);
      } catch (error) {
        console.error('Failed to fetch datasets:', error);
        setDatasets([]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <Layout incomingAction={incomingAction} action={action}>
      {isOpenAddDataset && <AddDataset isOpen={isOpenAddDataset} onClose={handleClose} />}
      {isOpenGenerateDataset && <GenerateDataset isOpen={isOpenGenerateDataset} onClose={handleClose} />}
      <div className="px-40 sm:px-6 lg:px-8">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-lg font-semibold leading-6 text-gray-900">Datasets</h1>
            <p className="mt-2 text-sm text-gray-700">List of datasets available.</p>
          </div>
        </div>
        <div className="mt-8 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
                <table className="min-w-full divide-y divide-gray-300">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Name</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Description</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Resolution</th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Type</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {datasets.map((dataset) => (
                      <tr key={dataset.id} onClick={() => handleDatasetClick(dataset)} className="cursor-pointer hover:bg-gray-50">
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{dataset.name}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{dataset.description}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{dataset.resolution}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{dataset.base ? 'Base' : dataset.for_testing ? 'Testing' : 'Training'}</td>
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

export async function getServerSideProps(context) {
  const base = context.query.base === 'true';
  return { props: { base } };
}
