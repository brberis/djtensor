import { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import Spinner from './Spinner';
import { PaperClipIcon, XCircleIcon } from '@heroicons/react/20/solid';

const datasetsGenerator = [
  { value: 50, label: '40 Training / 10 Validation' },
  { value: 100, label: '80 Training / 20 Validation' },
  { value: 150, label: '120 Training / 30 Validation' },
  { value: 200, label: '160 Training / 40 Validation' },
  { value: 250, label: '200 Training / 50 Validation' },
  { value: 300, label: '240 Training / 60 Validation' },
  { value: 350, label: '280 Training / 70 Validation' },
  { value: 400, label: '320 Training / 80 Validation' },
  { value: 450, label: '360 Training / 90 Validation' },
  { value: 500, label: '400 Training / 100 Validation' }
];

export default function AddSession({ isOpen, onClose }) {
  const [open, setOpen] = useState(isOpen);
  const [alert, setAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [datasets, setDatasets] = useState([]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/api/feature_extractor/tfmodel/');
        const data = await response.json();
        setModels(data);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setIsLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        const response = await fetch('/api/datasets/dataset/');
        const data = await response.json();
        setDatasets(data);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        setIsLoading(false);
      }
    };

    fetchDatasets();
  }, []);

  const handleClose = (result) => {
    setOpen(false);
    onClose(result);
  };

  const formHandler = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const selectedStudy = localStorage.getItem('selectedStudy'); 

    const newTraining = {
      study_id: selectedStudy, 
      name: formData.get('name'),
      notes: formData.get('notes'),
      dataset_id: formData.get('dataset'),
      model_id: formData.get('model'),
      hotdataset: formData.get('hotdataset')
    };


    setIsLoading(true);
    try {
      const response = await fetch('/api/feature_extractor/trainingsession/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newTraining),
      });
      if (response.ok) {
        handleClose(true);
      } else {
        const data = await response.json();
        setAlert(data.detail);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      setAlert('Failed to create session');
    }
  };

  if (isLoading) {
    return <Spinner timeOut={0} />;
  }

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-2 pb-4 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-xl sm:p-6">
                <div>
                  <button className="absolute top-0 right-0 p-2" onClick={handleClose}>
                    <svg className="h-6 w-6 text-gray-500 hover:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <Dialog.Title as="h3" className="text-lg text-center font-medium leading-6 text-gray-900">
                    New Training Session
                  </Dialog.Title>
                  <div className="mt-3 text-left sm:mt-5">
                    <div className="mt-2">
                      {alert && (
                        <div className="col-span-6 flex justify-center items-center mt-4 pb-2 bg-red-50">
                          <div className="flex mt-2">
                            <div className="flex-shrink-0">
                              <XCircleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
                            </div>
                            <div className="ml-3">
                              <h3 className="text-sm font-medium text-red-800">{alert}</h3>
                            </div>
                          </div>
                        </div>
                      )}
                      <form onSubmit={formHandler}>
                        <div className="grid grid-cols-8 sm:grid-cols-3 gap-6 mt-6">
                          <div className="col-span-6 sm:col-span-6">
                            <label htmlFor="name" className="block text-sm font-medium leading-5 text-gray-700">
                              Name
                            </label>
                            <div className="mt-1 rounded-md shadow-sm">
                              <input
                                id="name"
                                name="name"
                                type="text"
                                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                                required
                              />
                            </div>
                          </div>
                          <div className="col-span-6 sm:col-span-6">
                            <label htmlFor="model" className="block text-sm font-medium leading-5 text-gray-700">
                              Model
                            </label>
                            <div className="mt-1 rounded-md shadow-sm">
                              <select
                                id="model"
                                name="model"
                                required
                                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                              >
                                <option value="" disabled>
                                  Select a model...
                                </option>
                                {models?.map((model) => (
                                  <option key={model.id} value={model.id}>
                                    {model.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="col-span-6 sm:col-span-6">
                            <label htmlFor="dataset" className="block text-sm font-medium leading-5 text-gray-700">
                              Dataset for Training
                            </label>
                            <div className="mt-1 rounded-md shadow-sm">
                              <select
                                id="dataset"
                                name="dataset"
                                required
                                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                              >
                                <option value="" disabled>
                                  Select a dataset...
                                </option>
                                {datasets?.map((dataset) => (
                                  <option key={dataset.id} value={dataset.id}>
                                    {dataset.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="col-span-full">
                            <label htmlFor="notes" className="block text-sm font-medium leading-5 text-gray-700">
                              Notes
                            </label>
                            <div className="mt-1 rounded-md shadow-sm">
                              <textarea
                                id="notes"
                                name="notes"
                                className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-4 justify-end">
                          <div className="col-span-6 sm:col-span-3 mt-7">
                            <span className="w-full inline-flex rounded-md shadow-sm">
                              <div className="flex gap-4">
                                <button
                                  type="button"
                                  onClick={handleClose}
                                  className="relative w-full px-10 flex justify-center py-2 px-4 border border-gray-800 text-sm font-medium rounded-md text-gray-800 bg-white hover:bg-gray-100 focus:outline-none focus:border-gray-700 focus:shadow-outline-sky active:bg-gray-200"
                                >
                                  Close
                                </button>
                                <button
                                  type="submit"
                                  className="relative w-full px-10 flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-sky-600 hover:bg-sky-500 focus:outline-none focus:border-sky-700 focus:shadow-outline-sky active:bg-sky-800"
                                >
                                  Create
                                </button>
                              </div>
                            </span>
                          </div>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
