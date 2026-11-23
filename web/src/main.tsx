import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import './index.css';
import { SessionProvider, useSession } from './session';
import { Button, Empty, Icon, Spinner, ToastProvider } from './components/ui';
import { Login, Register } from './pages/Auth';
import { Onboarding, Pending } from './pages/Onboarding';
import Home from './pages/Home';
import Explore from './pages/Explore';
import ListingDetail from './pages/ListingDetail';
import ShareProduce from './pages/ShareProduce';
import Exchanges from './pages/Exchanges';
import ExchangeDetail from './pages/ExchangeDetail';
import WalletPage from './pages/Wallet';
import Profile from './pages/Profile';
import Community from './pages/Community';
import Notifications from './pages/Notifications';
import Admin from './pages/Admin';

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh max-w-md mx-auto bg-cream relative md:shadow-[0_0_0_1px_var(--color-line)]">{children}</div>;
}

function BottomNav() {
  const item = (to: string, icon: string, label: string) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-semibold transition ${isActive ? 'text-forest' : 'text-muted'}`}>
      {({ isActive }) => (<><Icon name={icon} size={23} strokeWidth={isActive ? 2.2 : 1.75} />{label}</>)}
    </NavLink>
  );
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 max-w-md mx-auto bg-white/95 backdrop-blur border-t border-line pb-safe" aria-label="Main">
      <div className="flex items-end">
        {item('/', 'home', 'Home')}
        {item('/explore', 'search', 'Explore')}
        <NavLink to="/share" className="flex-1 flex flex-col items-center -mt-5 pb-2 text-[11px] font-semibold text-forest" aria-label="Share produce">
          <span className="size-14 rounded-[20px] bg-forest text-white grid place-items-center shadow-lift ring-4 ring-cream"><Icon name="plus" size={26} strokeWidth={2.2} /></span>
          <span className="mt-1">Share</span>
        </NavLink>
        {item('/exchanges', 'swap', 'Exchanges')}
        {item('/profile', 'user', 'Profile')}
      </div>
    </nav>
  );
}

function AppShell() {
  return <><div className="pb-24"><Outlet /></div><BottomNav /></>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="pt-20"><Empty icon="info" title="Something went wrong on this screen" body={this.state.error.message}
      action={<Button onClick={() => { this.setState({ error: null }); window.location.assign('/'); }}>Back to home</Button>} /></div>;
  }
}

function Offline() {
  const { refresh } = useSession();
  return <div className="pt-24"><Empty icon="info" title="Can't reach Saanjha" body="The server isn't responding. If you're running it locally, check that npm run dev is running. Retrying automatically…"
    action={<Button variant="secondary" onClick={refresh}>Try now</Button>} /></div>;
}

/** Remount the form per route so leaving "Edit" for "Share" never carries old values over. */
function ShareRoute() {
  const { id } = useParams();
  const loc = useLocation();
  return <ShareProduce key={`${id ?? 'new'}${loc.search}`} />;
}

function Gate() {
  const { me, ready, offline } = useSession();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!me && offline) return <Offline />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const m = me.membership;
  if (!m || m.status === 'rejected') return <Navigate to="/onboarding" replace />;
  if (m.status === 'pending') return <Navigate to="/pending" replace />;
  return <Outlet />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { me, ready } = useSession();
  if (!ready) return <Spinner />;
  return me ? <Navigate to="/" replace /> : <>{children}</>;
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const { me, ready, offline } = useSession();
  if (!ready) return <Spinner />;
  if (!me && offline) return <Offline />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.membership?.status === 'approved') return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Frame>
            <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
              <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
              <Route path="/onboarding" element={<SignedIn><Onboarding /></SignedIn>} />
              <Route path="/pending" element={<SignedIn><Pending /></SignedIn>} />
              <Route element={<Gate />}>
                <Route element={<AppShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/explore" element={<Explore />} />
                  <Route path="/share" element={<ShareRoute />} />
                  <Route path="/listing/:id/edit" element={<ShareRoute />} />
                  <Route path="/exchanges" element={<Exchanges />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/community" element={<Community />} />
                  <Route path="/wallet" element={<WalletPage />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/admin" element={<Admin />} />
                </Route>
                <Route path="/listing/:id" element={<ListingDetail />} />
                <Route path="/exchanges/:id" element={<ExchangeDetail />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ErrorBoundary>
          </Frame>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
