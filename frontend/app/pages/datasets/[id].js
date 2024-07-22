import { useRouter } from 'next/router';
import { useEffect, useState, useCallback } from 'react';
import Layout from '../../components/Layout';
import axios from 'axios';
import Spinner from '../../components/Spinner';

export default function DatasetDetail() {
  const [dataset, setDataset] = useState(null);
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState({});
  const [hasMore, setHasMore] = useState({});
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    async function fetchData() {
      if (!id) return;

      setIsLoading(true);
      try {
        const [datasetData, labelsData] = await Promise.all([
          fetch(`/api/datasets/dataset/${id}`).then(res => res.json()),
          fetch(`/api/datasets/label/?datasets__id=${id}`).then(res => res.json())
        ]);

        setDataset(datasetData);
        setLabels(labelsData);

        // Initialize the state for each label
        const initialPages = {};
        const initialHasMore = {};
        labelsData.forEach(label => {
          initialPages[label.id] = 1;
          initialHasMore[label.id] = true;
          fetchImages(label.id, 1); 
        });
        setPage(initialPages);
        setHasMore(initialHasMore);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [id]);

  const fetchImages = useCallback(async (labelId, page) => {
    try {
      const res = await fetch(`/api/datasets/image/?dataset=${id}&label=${labelId}&page=${page}`);
      const data = await res.json();
      setImages(prev => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...data.results]
      }));
      setHasMore(prev => ({
        ...prev,
        [labelId]: data.next !== null
      }));
    } catch (error) {
      console.error('Failed to fetch images:', error);
    }
  }, [id]);

  const handleUpload = async (files, labelId, datasetId) => {
    const formData = new FormData();
    formData.append('label', labelId);
    formData.append('dataset', datasetId);
    Array.from(files).forEach(file => {
      formData.append('file', file);
    });

    try {
      const response = await axios.post('/api/datasets/image/upload', formData);
      if (response.status !== 201) {
        throw new Error('Failed to upload images');
      }
      if (!Array.isArray(response.data.images)) {
        throw new Error("Invalid image data received");
      }
      setImages(prev => ({
        ...prev,
        [labelId]: [...(prev[labelId] || []), ...response.data.images]
      }));
    } catch (error) {
      console.error('Error uploading images:', error);
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
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                {label.name} ({label.image_count})
              </h3>
              <input type="file" multiple onChange={(e) => handleUpload(e.target.files, label.id, dataset.id)} className="mb-2" />
              <div className="mt-2 flex overflow-x-auto space-x-4">
                {(images[label.id] || []).map(image => (
                  <div key={image.id} className="flex flex-col items-center relative group">
                    <p className="text-sm mt-2 whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '100px' }}>{image.image.split('/').pop()}</p>
                    <img src={image.image} alt={label.name} className="object-cover" style={{ width: '100px', height: '100px' }} loading="lazy" />
                    <div className="absolute left-0 bottom-0 bg-white opacity-0 group-hover:opacity-100 p-1 text-xs">
                      {image.image.split('/').pop()}
                    </div>
                  </div>
                ))}
                {hasMore[label.id] && (
                  <button
                    onClick={() => {
                      const nextPage = page[label.id] + 1;
                      setPage(prev => ({ ...prev, [label.id]: nextPage }));
                      fetchImages(label.id, nextPage);
                    }}
                    className="text-sm text-blue-500"
                  >
                    Load more
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
