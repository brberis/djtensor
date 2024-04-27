import Navbar from "../Navbar";
import Header from "../Header";
import Footer from "../Footer";
import { useRouter } from 'next/router';

const Layout = ({ children, sideBarNav, sectionTitle }) => {
  const router = useRouter();

  return (
    <div className="w-full">
      <Navbar />
      <div className={sideBarNav ? "flex" : ""}>
        <div className="flex-auto max-w-7xl sm:px-6 lg:px-8 mb-3">
          {/* <Header sectionTitle={sectionTitle} /> */}
          {children}
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default Layout;
