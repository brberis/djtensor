import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import axios from 'axios';
import Spinner from '../../components/Spinner';

export default function DatasetDetail() {
  const [dataset, setDataset] = useState(null);
  const [images, setImages] = useState([]);
  const [labels, setLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refresh, setRefresh] = useState(false);
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    async function fetchData() {
      if (!id) return;

      setIsLoading(true);
      try {
        const [datasetData, labelsData, imagesData] = await Promise.all([
          fetch(`/api/datasets/dataset/${id}`).then(res => res.json()),
          fetch(`/api/datasets/label/?datasets__id=${id}`).then(res => res.json()),
          fetch(`/api/datasets/image/?dataset=${id}`).then(res => res.json())
        ]);

        setDataset(datasetData);
        setLabels(labelsData);
        setImages(imagesData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [id, refresh]);

  const handleUpload = async (files, labelId, datasetId) => {
    const formData = new FormData();
    formData.append('label', labelId);
    formData.append('dataset', datasetId);
    Array.from(files).forEach(file => {
      formData.append('file', file);
    });
  
    try {
      const response = await axios.post('/api/datasets/image/upload', formData);
      console.log(response.data);  
      if (response.status !== 201) {
        throw new Error('Failed to upload images');
      }
      if (!Array.isArray(response.data.images)) {
        throw new Error("Invalid image data received");
      }
      setImages(prev => [...prev, ...response.data.images]);
      setRefresh((prevRefresh) => !prevRefresh);
    } catch (error) {
      console.error('Error uploading images:', error);
      setRefresh((prevRefresh) => !prevRefresh);
    }
  };
  

  if (isLoading) {
    return <Spinner />;
  }

  if (!dataset || dataset.message) {
    return <p>No dataset data found.</p>;
  }

  return (
    <Layout>
      <div className="px-40 sm:px-6 lg:px-8">
        <h1 className="text-lg font-semibold leading-6 text-gray-900">Dataset Detail</h1>
        <p className="mt-2 text-sm text-gray-700">Detailed information about the dataset named {dataset.name}.</p>
        <div className="mt-4 bg-white shadow overflow-hidden sm:rounded-lg">
          {labels.map(label => (
            <div key={label.id} className="px-4 py-5 sm:px-6 border-t border-gray-200">
              <h3 className="text-lg leading-6 font-medium text-gray-900">{label.name}</h3>
              <input type="file" multiple onChange={(e) => handleUpload(e.target.files, label.id, dataset.id)} className="mb-2" />
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                {images.filter(image => image.label === label.id).map(image => (
                  <div key={image.id} className="flex flex-col items-center px-2">
                    <img src={image.image} alt={label.name} className="object-cover h-24 w-24" style={{ width: '100px', height: '100px' }} />
                    <p className="text-sm mt-2 whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '100px' }}>{image.image.split('/').pop()}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
