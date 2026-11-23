import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

interface Session { me: Me | null; ready: boolean; offline: boolean; refresh: () => Promise<void>; setMe: (m: Me | null) => void; logout: () => Promise<void> }
const Ctx = createContext<Session>(null!);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/me')); setOffline(false); }
    catch (e) {
      // Only a real 401 signs the user out; a server restart or flaky network must not.
      if ((e as ApiError).status === 401) { setMe(null); setOffline(false); } else setOffline(true);
    } finally { setReady(true); }
  }, []);
  const logout = useCallback(async () => { await api.post('/auth/logout').catch(() => {}); setMe(null); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => setMe(null);
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, []);
  // Keep balance and notification badge fresh
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30_000);
    return () => clearInterval(t);
  }, [me, refresh]);
  // While offline (first load failed), keep retrying quietly
  useEffect(() => {
    if (!offline) return;
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [offline, refresh]);
  return <Ctx.Provider value={{ me, ready, offline, refresh, setMe, logout }}>{children}</Ctx.Provider>;
}
