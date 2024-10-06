import { Suspense, lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { createBrowserRouter, Navigate } from "react-router-dom";
import Layout from "../layout";
import VaultsLayout from "../layout/vaults";

const Vaults = lazy(() => import("../view/vaults/vaults-container"));
const Sftp = lazy(() => import("../view/sftp/sftp-container"));
const Loading = () => <div>Loading...</div>;

const warpCom = (Com: any) => {
  return (
    <Suspense fallback={<Loading />}>
      <Com />
    </Suspense>
  );
};

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <div>error</div>,
    children: [
      {
        path: "/",
        element: <Navigate to="/vaults" />,
      },
      {
        path: "vaults",
        element: <VaultsLayout />,
        children: [
          {
            path: "",
            element: warpCom(Vaults),
          },
        ],
      },
      {
        path: "sftp",
        element: warpCom(Sftp),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
