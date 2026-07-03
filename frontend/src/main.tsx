import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./Layout";
import Home from "./pages/Home";
import Apply from "./pages/Apply";
import Dashboard from "./pages/Dashboard";
import Pool from "./pages/Pool";
import Roadmap from "./pages/Roadmap";
import "./styles.css";

const config = getDefaultConfig({
  appName: "Redact",
  projectId: "REDACT_DEMO_REPLACE_ME",
  chains: [sepolia],
  transports: {
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
  },
  ssr: false,
});

const queryClient = new QueryClient();

// Hash router keeps deep links working on static hosts like Vercel without rewrites.
const router = createHashRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "apply", element: <Apply /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "pool", element: <Pool /> },
      { path: "roadmap", element: <Roadmap /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#ff5a1f",
            accentColorForeground: "#1a0900",
            borderRadius: "small",
            fontStack: "system",
          })}
        >
          <RouterProvider router={router} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
