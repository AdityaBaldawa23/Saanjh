import { useState } from 'react';
import { kg, useQuery } from '../lib';
import { Card, Empty, ErrorState, Spinner, TopBar } from '../components/ui';

interface Stats {
  society: { name: string }; members: number; households: number; live_listings: number;
  exchanges: number; grams: number; fruit_grams: number; veg_grams: number; leafy_grams: number; credits: number;
  months: { key: string; label: string; exchanges: number; grams: number }[];
  top: { name: string; category: string; exchanges: number; grams: number }[];
}

// Validated categorical palette (dataviz validator: all checks pass; contrast relieved by visible values)
const CAT = [
  { key: 'veg_grams', label: 'Vegetables', color: '#2E8050' },
  { key: 'fruit_grams', label: 'Fruits', color: '#D6981A' },
  { key: 'leafy_grams', label: 'Greens & herbs', color: '#7A5BC0' },
] as const;

function Tile({ value, label }: { value: string | number; label: string }) {
  return <Card className="p-4"><p className="text-2xl font-extrabold tracking-tight">{value}</p><p className="text-xs text-muted mt-0.5">{label}</p></Card>;
}

function MonthlyBars({ months }: { months: Stats['months'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.grams));
  const H = 140;
  return (
    <div>
      <div className="h-6 text-sm text-ink" aria-live="polite">
        {hover !== null ? <><b>{months[hover].label}</b>: {kg(months[hover].grams)} · {months[hover].exchanges} exchange{months[hover].exchanges === 1 ? '' : 's'}</> : <span className="text-muted">Tap a bar for details</span>}
      </div>
      <div className="relative mt-2" style={{ height: H }}>
        {[0.5, 1].map((f) => <div key={f} className="absolute inset-x-0 border-t border-line/70" style={{ bottom: H * f }} />)}
        <div className="absolute inset-x-0 bottom-0 border-t border-line" />
        <div className="absolute inset-0 flex items-end gap-2">
          {months.map((m, i) => (
            <button key={m.key} className="flex-1 h-full flex items-end justify-center group" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
              aria-label={`${m.label}: ${kg(m.grams)}, ${m.exchanges} exchanges`}>
              <span className={`w-full max-w-9 rounded-t-[4px] transition-opacity ${hover !== null && hover !== i ? 'opacity-40' : ''}`}
                style={{ height: m.grams ? Math.max(4, (m.grams / max) * H) : 0, background: '#2E8050' }} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-2">{months.map((m) => <span key={m.key} className="flex-1 text-center text-[11px] text-muted">{m.label}</span>)}</div>
      <p className="text-[11px] text-muted mt-1">Peak: {kg(max)}</p>
    </div>
  );
}

export default function Community() {
  const { data: s, loading, error, reload } = useQuery<Stats>('/society/stats');
  const [table, setTable] = useState(false);
  if (loading) return <><TopBar title="Community impact" /><Spinner /></>;
  if (error || !s) return <><TopBar title="Community impact" /><ErrorState message={error?.message ?? ''} retry={reload} /></>;
  const total = s.veg_grams + s.fruit_grams + s.leafy_grams;

  return (
    <div>
      <TopBar title="Community impact" />
      <div className="px-5 pt-4 space-y-4 pb-8">
        <div className="rounded-3xl bg-forest text-white p-5">
          <p className="text-mint/80 text-sm font-medium">{s.society.name} has kept</p>
          <p className="text-[40px] leading-none font-extrabold mt-2 tracking-tight">{kg(s.grams)}</p>
          <p className="text-mint/90 text-sm mt-2">of fruit and vegetables out of the bin, through {s.exchanges} neighbour-to-neighbour exchange{s.exchanges === 1 ? '' : 's'}.</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Tile value={s.exchanges} label="Exchanges" />
          <Tile value={s.households} label={`of ${s.members} homes took part`} />
          <Tile value={s.live_listings} label="Shared right now" />
        </div>

        {s.exchanges === 0 ? (
          <Card><Empty icon="chart" title="No completed exchanges yet" body="Figures appear here as soon as neighbours complete their first exchange." /></Card>
        ) : (
          <>
            <Card className="p-5">
              <h2 className="font-bold">Produce redistributed by month</h2>
              <p className="text-xs text-muted mb-3">Last 6 months, estimated weight</p>
              <MonthlyBars months={s.months} />
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold">What gets shared</h2>
                <button onClick={() => setTable(!table)} className="text-xs font-semibold text-forest">{table ? 'Show chart' : 'Show table'}</button>
              </div>
              {table ? (
                <table className="w-full text-sm mt-3">
                  <thead><tr className="text-left text-muted text-xs"><th className="font-medium py-1">Category</th><th className="font-medium text-right">Weight</th><th className="font-medium text-right">Share</th></tr></thead>
                  <tbody>{CAT.map((c) => <tr key={c.key} className="border-t border-line/60"><td className="py-2">{c.label}</td><td className="text-right tabular-nums">{kg(s[c.key])}</td><td className="text-right tabular-nums">{total ? Math.round((s[c.key] / total) * 100) : 0}%</td></tr>)}</tbody>
                </table>
              ) : (
                <>
                  <div className="flex h-4 gap-[2px] rounded-[4px] overflow-hidden mt-4" role="img" aria-label={CAT.map((c) => `${c.label} ${kg(s[c.key])}`).join(', ')}>
                    {CAT.map((c) => s[c.key] > 0 && <span key={c.key} title={`${c.label}: ${kg(s[c.key])}`} style={{ flexGrow: s[c.key], background: c.color }} />)}
                  </div>
                  <ul className="mt-4 space-y-2">
                    {CAT.map((c) => (
                      <li key={c.key} className="flex items-center gap-2.5 text-sm">
                        <span className="size-3 rounded-[3px]" style={{ background: c.color }} />
                        <span className="flex-1">{c.label}</span>
                        <span className="font-semibold tabular-nums">{kg(s[c.key])}</span>
                        <span className="w-10 text-right text-muted tabular-nums">{total ? Math.round((s[c.key] / total) * 100) : 0}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {s.top.length > 0 && (
              <Card className="p-5">
                <h2 className="font-bold mb-3">Most shared</h2>
                <ol className="space-y-3">
                  {s.top.map((t, i) => (
                    <li key={t.name} className="flex items-center gap-3 text-sm">
                      <span className="size-7 rounded-full bg-mint-soft text-forest grid place-items-center text-xs font-bold">{i + 1}</span>
                      <span className="flex-1 font-medium">{t.name}</span>
                      <span className="text-muted">{t.exchanges}×</span>
                      <span className="w-16 text-right font-semibold tabular-nums">{kg(t.grams)}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </>
        )}
        <p className="text-xs text-muted text-center">Every number comes from completed exchanges in your society. Pieces are converted to weight using typical sizes.</p>
      </div>
    </div>
  );
}
