import { Suspense, lazy } from "react";
import type { RouteObject } from "react-router-dom";
import { createBrowserRouter } from "react-router-dom";
import Layout from "../layout";

const Loading = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-muted-foreground">Loading...</div>
  </div>
);

// Lazy load views for better performance
const HostsView = lazy(() => import("../view/hosts"));
const SftpView = lazy(() => import("../view/sftp/sftp-container"));
const TerminalView = lazy(() => import("../view/terminal/terminal-container"));
const VaultsView = lazy(() => import("../view/vaults/vaults-container"));
const KeychainView = lazy(() => import("../view/keychain"));
const PortForwardView = lazy(() => import("../view/port-forward"));
const SnippetsView = lazy(() => import("../view/snippets"));
const KnownHostsView = lazy(() => import("../view/known-hosts"));
const LogsView = lazy(() => import("../view/logs"));

const warpCom = (Com: React.ComponentType) => {
  return (
    <Suspense fallback={<Loading />}>
      <Com />
    </Suspense>
  );
};

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <div>Error loading page</div>,
    children: [
      // Default route - Home/Hosts
      {
        index: true,
        element: warpCom(HostsView),
      },
      // Hosts - SSH connections
      {
        path: "hosts",
        element: warpCom(HostsView),
      },
      // Terminal - Active terminal sessions
      {
        path: "terminal",
        element: warpCom(TerminalView),
      },
      // SFTP - File transfer
      {
        path: "sftp",
        element: warpCom(SftpView),
      },
      // Vaults - Encrypted storage
      {
        path: "vaults",
        element: warpCom(VaultsView),
      },
      // Keychain - SSH keys and certificates
      {
        path: "keychain",
        element: warpCom(KeychainView),
      },
      // Port Forwarding - SSH tunnels
      {
        path: "port-forward",
        element: warpCom(PortForwardView),
      },
      // Snippets - Command scripts
      {
        path: "snippets",
        element: warpCom(SnippetsView),
      },
      // Known Hosts - SSH host fingerprints
      {
        path: "known-hosts",
        element: warpCom(KnownHostsView),
      },
      // Logs - Connection history
      {
        path: "logs",
        element: warpCom(LogsView),
      },
    ],
  },
  {
    path: "*",
    element: (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">404</h1>
          <p className="text-muted-foreground">Page not found</p>
        </div>
      </div>
    ),
  },
];

export const router = createBrowserRouter(routes);
