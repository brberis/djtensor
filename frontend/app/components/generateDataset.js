import { Fragment, useState, useEffect, useRef } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import Spinner from './Spinner';
import { XCircleIcon } from '@heroicons/react/20/solid'

const resolutions = [
  {res: '224', des: '224x224'},
  // {res: '240', des: '240x240'},
  // {res: '260', des: '260x260'},
  // {res: '299', des: '299x299'},
  // {res: '300', des: '300x300'},
  // {res: '331', des: '331x331'},
  // {res: '456', des: '456x456'},
  // {res: '480', des: '480x480'},
  {res: '384', des: '384x384'},
  {res: '512', des: '512x512'}
  // {res: '528', des: '528x528'},
];

export default function GenerateDataset({ isOpen, onClose }) {
  const [open, setOpen] = useState(isOpen);
  const [alert, setAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [labels, setLabels] = useState([]);
  const [base, setBase] = useState(false);
  const [forTesting, setForTesting] = useState(false);


  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const baseParam = queryParams.get('base');
    setBase(true);
    setForTesting(baseParam !== 'true');

    async function fetchData() {
      setIsLoading(true);
      try {
        const [labelsData] = await Promise.all([
          fetch(`/api/datasets/label/`).then(res => res.json()),
        ]);
        setLabels(labelsData);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);


  const handleClose = (result) => {
    setOpen(false);
    onClose(result);
  }

  


  const formHandler = async (e) => {
    
    e.preventDefault();

    const formData = new FormData(e.target);
    const selectedStudy = localStorage.getItem('selectedStudy'); 

    const newDataset = {
      study: selectedStudy, 
      name: formData.get('name'), 
      labels: formData.getAll('labels'),
      description: formData.get('description'),
      resolution: formData.get('resolution'),
      base: false,
      for_testing: formData.get('forTesting') === 'on' ? true : false,
      sample_number: formData.get('sampleNumber')
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/datasets/generate-dataset/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newDataset),
      });
      if (response.ok) {
        setIsLoading(false);
        handleClose(true);
      } else {
        const data = await response.json();
        setAlert(data.detail);
      }
    } catch (error) {
      console.error('Failed to create dataset:', error);
      setAlert('Failed to create dataset');
      setIsLoading(false);

    }
  }

  if (isLoading) {
    return (
      <Spinner timeOut={0}/>
    )
  }


  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-40"  onClose={handleClose} onClick={handleClose}>
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
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-2 pb-4 text-left shadow-xl transition-all  sm:my-8 sm:w-full sm:max-w-xl sm:p-6">
              <div>
                <button className="absolute top-0 right-0 p-2" onClick={handleClose}>
                  <svg className="h-6 w-6 text-gray-500 hover:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <Dialog.Title as="h3" className="text-lg text-center font-medium leading-6 text-gray-900">
                    New Dataset
                </Dialog.Title>
                <div className="mt-3 text-left sm:mt-5">
                  <div className="mt-2">
                  { alert &&
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

                    }
                    <form onSubmit={formHandler}>
                      <div className="grid grid-cols-8 sm:grid-cols-3 gap-6 mt-6">
                        {/* Existing fields remain unchanged */}
                        <div className="col-span-6 sm:col-span-6">
                          <label htmlFor="name" className="block text-sm font-medium leading-5 text-gray-700">
                            Name
                          </label>
                          <div className="mt-1 rounded-md shadow-sm">
                            <input
                              id="name"
                              name="name"
                              type="text"
                              required
                              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                          </div>
                        </div>

                        <div className="col-span-6 sm:col-span-6">
                          <label htmlFor="resolution" className="block text-sm font-medium leading-5 text-gray-700">
                            Resolution
                          </label>
                          <div className="mt-1 rounded-md shadow-sm">
                            <select
                              id="resolution"
                              name="resolution"
                              required
                              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                              >
                              <option disabled >Select resolution...</option>
                                {resolutions.map((resolution) => (
                                  <option key={resolution.res} value={resolution.res}>{resolution.des}</option>
                                ))}
                            </select>
                          </div>
                        </div>
                        <div className="col-span-6 sm:col-span-6">
                          <label htmlFor="labels" className="block text-sm font-medium leading-5 text-gray-700">
                            Select the labels
                          </label>
                          <div className="mt-1 rounded-md shadow-sm">
                            <select
                              id="labels"
                              name="labels"
                              multiple
                              required
                              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            >
                              {labels.map((label) => (  
                                <option key={label.id} value={label.id}>{label.name}</option>
                              ))
                              }
                            </select>
                          </div>
                        </div>
                        <div className="col-span-6 sm:col-span-6">
                          <label htmlFor="forTesting" className="block text-sm font-medium leading-5 text-gray-700">
                            For Testing
                          </label>
                          <div className="mt-1">
                            <input
                              id="forTesting"
                              name="forTesting"
                              type="checkbox"
                              onChange={() => setBase(!forTesting)}
                              className="block rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                          </div>
                        </div>
                        <div className="col-span-6 sm:col-span-3">
                          <label htmlFor="sampleNumber" className="block text-sm font-medium leading-5 text-gray-700">
                            Number of Samples per Label (Training and Validaion)
                          </label>
                          <div className="mt-1 rounded-md shadow-sm">
                            <input
                              id="sampleNumber"
                              name="sampleNumber"
                              type="number"
                              required
                              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                          </div>
                        </div>
                        <div className="col-span-full">
                          <label htmlFor="notes" className="block text-sm font-medium leading-5 text-gray-700">
                            Description
                          </label>
                          <div className="mt-1 rounded-md shadow-sm">
                            <textarea
                              id="description"
                              name="description"
                              className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Button Section Unchanged */}
                      <div className={`flex gap-4 justify-end`}>
                        <div className="col-span-6 sm:col-span-3 mt-7">
                          <span className="w-full inline-flex rounded-md shadow-sm">
                            <div className='flex gap-4'>
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
  