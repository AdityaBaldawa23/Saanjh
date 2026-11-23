import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '../lib';
import type { Listing } from '../types';
import { ListingCard } from '../components/ListingCard';
import { Chip, Empty, ErrorState, Icon, inputCls, Spinner } from '../components/ui';

const CATS = [['', 'All'], ['vegetable', 'Vegetables'], ['fruit', 'Fruits'], ['leafy', 'Greens & herbs']] as const;
const SORTS = [['', 'Newest'], ['expiring', 'Collect soonest'], ['quantity', 'Most available']] as const;

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const update = (k: string, v: string) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); };
  const qs = new URLSearchParams({ q: debounced, category, sort }).toString();
  const { data, loading, error, reload } = useQuery<Listing[]>(`/listings?${qs}`, [qs]);

  return (
    <div>
      <div className="sticky top-0 z-20 bg-cream/95 backdrop-blur pt-5 pb-3 border-b border-line/60">
        <h1 className="px-5 text-[22px] font-extrabold">Explore</h1>
        <div className="px-5 mt-3 relative">
          <Icon name="search" size={20} className="absolute left-9 top-3.5 text-muted" />
          <input className={`${inputCls} pl-11`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tomatoes, bananas, coriander…" type="search" aria-label="Search produce" />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-5 mt-3">
          {CATS.map(([v, t]) => <Chip key={v} active={category === v} onClick={() => update('category', v)}>{t}</Chip>)}
        </div>
        <div className="flex gap-4 px-5 mt-3 text-sm">
          {SORTS.map(([v, t]) => (
            <button key={v} onClick={() => update('sort', v)} className={`font-semibold ${sort === v ? 'text-forest underline underline-offset-4 decoration-2' : 'text-muted'}`}>{t}</button>
          ))}
        </div>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorState message={error.message} retry={reload} /> : data!.length === 0 ? (
        <Empty icon="search" title="Nothing matches yet" body={debounced ? `No one has shared "${debounced}" right now. Check back later.` : 'No produce available in this category right now.'} />
      ) : (
        <>
          <p className="px-5 pt-4 text-xs text-muted font-medium">{data!.length} item{data!.length === 1 ? '' : 's'} available in your society</p>
          <div className="grid grid-cols-2 gap-3 p-5 pt-3">{data!.map((l) => <ListingCard key={l.id} l={l} />)}</div>
        </>
      )}
    </div>
  );
}
