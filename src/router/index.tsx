import { Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import { createBrowserRouter, Navigate } from "react-router-dom";
import Layout from "../layout";
import VaultsLayout from "../layout/vaults";
import Vaults from "../view/vaults/vaults-container";
import Sftp from "../view/sftp/sftp-container";
import Terminal from "../view/terminal/terminal-container";

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
      {
        path: "terminal",
        element: warpCom(Terminal),
      },
    ],
  },
  {
    path: "*",
    element: <div>not found</div>,
  },
];

export const router = createBrowserRouter(routes);
