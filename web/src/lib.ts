import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { UnitType } from './types';

export function useQuery<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    if (!path) return;
    const n = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

export function formatQty(unit: UnitType, q: number) {
  if (unit === 'piece') return `${q} pc${q === 1 ? '' : 's'}`;
  return q >= 1000 ? `${+(q / 1000).toFixed(2)} kg` : `${q} g`;
}
export const kg = (grams: number) => (grams >= 1000 ? `${(grams / 1000).toFixed(grams >= 10000 ? 0 : 1)} kg` : `${grams} g`);

/** Mirrors server pricing for a live preview only. The server always recomputes. */
export function previewCredits(unit: UnitType, rate: number, q: number, min = 2) {
  const raw = unit === 'weight' ? (q / 1000) * rate : q * rate;
  return Math.max(min, Math.round(raw));
}

export function rateLabel(unit: UnitType, rate: number) {
  return unit === 'weight' ? `${rate} credits / kg` : `${rate} credit${rate === 1 ? '' : 's'} / piece`;
}

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function whenLabel(t: number) {
  const d = new Date(t), today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow, ${time}`;
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export function timeLeft(t: number) {
  const ms = t - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min left`;
  if (h < 24) return `${h} h left`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} left`;
}

export const CATEGORY_LABEL = { fruit: 'Fruits', vegetable: 'Vegetables', leafy: 'Greens & herbs' } as const;
export const CONDITION = {
  fresh: { label: 'Fresh', hint: 'Bought recently, firm and unblemished' },
  good: { label: 'Good', hint: 'Fine to eat, a few days old' },
  use_soon: { label: 'Use soon', hint: 'Ripe. Best used within a day' },
} as const;

export const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
