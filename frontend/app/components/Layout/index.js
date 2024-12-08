/*
 * Shark AI
 * Author: Cristobal Barberis
 * License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
 * For academic use only. Commercial use is prohibited without prior written permission.
 * Contact: cristobal@barberis.com
 *
 * File: index.js
 * Copyright (c) 2024
 */

import Navbar from "../Navbar";
import Header from "../Header";
import Footer from "../Footer";
import Sidebar from "../Sidebar";
import { useRouter } from 'next/router';

const Layout = (props) => {
  const router = useRouter();
  const { children, sectionTitle, action, actions, incomingAction, title, breadcrumbs, sideBarNav } = props;

  function classNames(...classes) {
    return classes.filter(Boolean).join(' ');
  }

  return (
    <div className="w-full">
      <Navbar/>
      <div className={classNames(sideBarNav && "flex")}>
        {sideBarNav && <Sidebar navigation={sideBarNav}/>}
        <div className={classNames("flex-auto", "max-w-7xl sm:px-6 lg:px-8 mb-3")}>
          <Header sectionTitle={sectionTitle} action={action} actions={actions} incomingAction={incomingAction} breadcrumbs={breadcrumbs} title={title} />
          {children}
        </div>
      </div>
      <Footer />
    </div>
  )
}

export default Layout;
