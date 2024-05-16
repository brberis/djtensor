import { InformationCircleIcon } from '@heroicons/react/20/solid';

export default function Tooltip({ text }) {
  return (
    <div className="relative group inline-block">
      <InformationCircleIcon className="w-4 h-4 text-sky-500 cursor-pointer ml-1" />
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded-lg p-2 z-10 shadow-lg w-48">
        {text}
      </div>
    </div>
  );
}
