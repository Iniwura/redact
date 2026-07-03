import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useCallback, useEffect, useState } from "react";
import { USDC_ADDRESS, ERC20_ABI } from "./lib/contracts";

function IconDrop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
      <path d="M12 3.5c3.2 4 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.8-6.3 6-10.3z" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" aria-hidden="true">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
    </svg>
  );
}

function IconMenu({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true">
      {open ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

export default function Layout() {
  const location = useLocation();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [minting, setMinting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("redact-theme") : null;
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("redact-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const refresh = useCallback(async () => {
    if (!address || !publicClient) return setBalance(null);
    try {
      const bal = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      setBalance(bal);
    } catch {
      setBalance(null);
    }
  }, [address, publicClient]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function faucet() {
    if (!address || !walletClient || !publicClient || minting) return;
    setMinting(true);
    try {
      const hash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [address, 100_000000n],
        account: address,
        chain: walletClient.chain,
      });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status === "success") await refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="shell">
      <header className="nav-wrap">
        <nav className="pill-nav">
          <NavLink to="/" className="brand" end>
            <span className="brand-mark">R</span>
            <span className="brand-name">REDACT</span>
          </NavLink>
          <div className="nav-links">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/apply">Apply</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/pool">Pool</NavLink>
            <NavLink to="/roadmap">Roadmap</NavLink>
          </div>
          <div className="nav-actions">
            {isConnected && balance !== null && (
              <span className="balance mono">{(Number(balance) / 1e6).toLocaleString()} rUSDC</span>
            )}
            <button
              className="theme-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            {isConnected && (
              <button
                className="faucet-btn"
                onClick={faucet}
                disabled={minting}
                title="Mint 100 test rUSDC"
                aria-label="Mint 100 test rUSDC"
              >
                <IconDrop />
              </button>
            )}
            <ConnectButton showBalance={false} accountStatus="address" chainStatus="none" />
            <button
              className="menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              <IconMenu open={menuOpen} />
            </button>
          </div>
        </nav>
        {menuOpen && (
          <div className="mobile-menu">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/apply">Apply</NavLink>
            <NavLink to="/dashboard">Dashboard</NavLink>
            <NavLink to="/pool">Pool</NavLink>
            <NavLink to="/roadmap">Roadmap</NavLink>
            {isConnected && balance !== null && (
              <span className="mono mobile-balance">{(Number(balance) / 1e6).toLocaleString()} rUSDC</span>
            )}
          </div>
        )}
      </header>
      <div className="page-fade" key={location.pathname}>
        <Outlet />
      </div>
      <footer className="footer">
        <div className="footer-inner">
          <span className="mono footer-tag">[DATA REDACTED]</span>
          <p>
            Built on the Zama Protocol. Contracts verified on Sepolia. Demo inputs are partly self-reported; production
            uses attested credentials throughout. Not a real credit decision.
          </p>
        </div>
      </footer>
    </div>
  );
}
