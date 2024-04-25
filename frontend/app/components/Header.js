import { useState, useEffect } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import Link from "next/link";

export default function Header(props) {
  const { sectionTitle, action, actions, incomingAction, breadcrumbs, smallScreenHeader, isLocal} = props;
  const [ariaCurrent, setAriaCurrent] = useState(null);
  const [defaultBgColor, setDefaultBgColor] = useState('stone');
  const [sidebarWidth, setSidebarWidth] = useState(300); // Initial sidebar width
  const [isSmallScreen, setIsSmallScreen] = useState(false); 

  const actionHandler = (e) => {
    incomingAction(e);
  };

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarWidth(80);
        setIsSmallScreen(true); // Set to true for small screens
      } else {
        setSidebarWidth(160);
        setIsSmallScreen(false); // Set to false for larger screens
      }
    };
  
    window.addEventListener("resize", handleResize);
    handleResize(); // Call initially
  
    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);
  

  return (
      <>
      <div className='md:m-4'>  
        <div className='hidden sm:block'>
          <nav className="sm:hidden" aria-label="Back">
            <Link href="#" className="flex items-center text-sm font-medium text-gray-500 hover:text-gray-700">
              <ChevronLeftIcon className="-ml-1 mr-1 h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" />
              Back
            </Link>
          </nav>
          { (breadcrumbs && !isLocal) &&
          <nav className="hidden sm:flex" aria-label="Breadcrumb">
            <ol role="list" className="flex items-center space-x-4">
              {breadcrumbs.map((bc) => (
                <li key={bc.title}>
                  <>
                  <div className={`flex items-center ${breadcrumbs.indexOf(bc) > 0 ? 'items-center' : ''}`}>
                  {breadcrumbs.indexOf(bc) > 0 ? <ChevronRightIcon className="h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" /> : null}
                    <Link href={bc.href} aria-current={ariaCurrent} className={'text-sm font-medium text-gray-500 hover:text-gray-700'}>
                      {bc.title}
                    </Link>
                  </div>
                  </>
                </li>         
              ))}
            </ol>
          </nav>
          }
        </div>
        <div className="flex items-center justify-between border-b border-gray-200 py-4 px-4 lg:flex-none">

          <div className="min-w-0 flex-1">
            <h2 className="md:ml-0 text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              {sectionTitle}
            </h2>
          </div>
          {action &&
            <div className="mt-4 flex flex-shrink-0 md:mt-0 md:ml-4 sm:-mr-8">
              <button
                type="button"
                onClick={() => actionHandler(true)}
                className="ml-3 inline-flex items-center rounded-md border border-transparent bg-stone-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2"
              >
                {action}
              </button>
            </div>
          }

          {actions ? 
            <div className="mt-4 flex flex-shrink-0 md:mt-0 md:ml-4 sm:-mr-8">
              {actions && actions.map((action, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => actionHandler(action.title)}
                  className= {`${index < (actions.length-1) && 'hidden'} sm:block ml-3 inline-flex items-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white shadow-sm bg-${action.bgColor ? action.bgColor : defaultBgColor}-600 hover:bg-${action.bgColor ? action.bgColor : defaultBgColor}-700 focus:outline-none focus:ring-2 focus:ring-${action.bgColor ? action.bgColor : defaultBgColor}-500 focus:ring-offset-2`}
                >
                  {action.title}
                </button>
              ))}
            </div>
          : null}
        </div>
      </div>
      </>
    
  )
}
