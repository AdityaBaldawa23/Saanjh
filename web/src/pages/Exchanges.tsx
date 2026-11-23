import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { timeAgo, useQuery, whenLabel } from '../lib';
import type { Exchange } from '../types';
import { Button, Chip, Empty, ErrorState, Icon, ProduceImage, Spinner, StatusBadge } from '../components/ui';

const TABS = [
  { key: 'incoming', label: 'Incoming', hint: 'Requests for produce you shared' },
  { key: 'outgoing', label: 'My requests', hint: "Produce you've asked for" },
  { key: 'history', label: 'History', hint: 'Completed & closed' },
] as const;

function ExRow({ e }: { e: Exchange }) {
  const giver = e.role === 'giver';
  const action =
    e.status === 'pending' && giver ? 'Reply needed' :
    e.status === 'accepted' && !giver ? (e.requester_confirmed ? 'Waiting for them to confirm' : e.owner_confirmed ? 'Confirm you received it' : `Collect by ${whenLabel(e.produce.available_until)}`) :
    e.status === 'accepted' && giver ? (e.owner_confirmed ? 'Waiting for them to confirm' : e.requester_confirmed ? 'They received it, confirm handover' : 'Hand over & confirm') : null;
  return (
    <Link to={`/exchanges/${e.id}`} className="flex gap-3 p-3 bg-white rounded-3xl shadow-card">
      <ProduceImage src={e.produce.photo_url} emoji={e.produce.emoji} category={e.produce.category} alt={e.produce.name} className="size-20 rounded-2xl shrink-0" />
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold truncate">{e.quantity_label} {e.produce.name}</p>
          <span className={`text-sm font-bold shrink-0 ${giver ? 'text-leaf' : 'text-earth'}`}>{giver ? '+' : '−'}{e.credits}</span>
        </div>
        <p className="text-xs text-muted mt-0.5 truncate">{giver ? 'To' : 'From'} {e.counterparty.name} · {e.counterparty.location}</p>
        <div className="flex items-center justify-between gap-2 mt-2">
          <StatusBadge status={e.status} />
          <span className="text-[11px] text-muted">{timeAgo(e.closed_at ?? e.accepted_at ?? e.created_at)}</span>
        </div>
        {action && <p className="text-xs font-semibold text-forest mt-1.5 flex items-center gap-1"><Icon name="clock" size={13} />{action}</p>}
      </div>
    </Link>
  );
}

const HISTORY_FILTERS = [
  ['all', 'All'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['other', 'Declined / expired'],
] as const;

function Group({ title, items }: { title: string; items: Exchange[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{title} · {items.length}</h2>
      {items.map((e) => <ExRow key={e.id} e={e} />)}
    </section>
  );
}

export default function Exchanges() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'incoming' | 'outgoing' | 'history') || 'incoming';
  const [filter, setFilter] = useState<(typeof HISTORY_FILTERS)[number][0]>('all');
  const { data, loading, error, reload } = useQuery<Exchange[]>('/exchanges');
  const nav = useNavigate();
  const open = (e: Exchange) => ['pending', 'accepted'].includes(e.status);
  const lists = {
    incoming: (data ?? []).filter((e) => e.role === 'giver' && open(e)),
    outgoing: (data ?? []).filter((e) => e.role === 'receiver' && open(e)),
    history: (data ?? []).filter((e) => !open(e)),
  };
  const history = lists.history.filter((e) =>
    filter === 'all' ? true : filter === 'other' ? ['rejected', 'expired', 'no_show'].includes(e.status) : e.status === filter);
  const count = (k: keyof typeof lists) => lists[k].length;

  return (
    <div>
      <div className="sticky top-0 z-20 bg-cream/95 backdrop-blur pt-5 border-b border-line/60">
        <h1 className="px-5 text-[22px] font-extrabold">My exchanges</h1>
        <div className="flex px-3 mt-3">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setParams({ tab: t.key }, { replace: true })} className={`flex-1 pb-3 pt-1 text-sm font-semibold border-b-2 transition ${tab === t.key ? 'border-forest text-forest' : 'border-transparent text-muted'}`}>
              {t.label}{t.key !== 'history' && count(t.key) > 0 && <span className="ml-1.5 text-[11px] bg-honey text-ink px-1.5 py-0.5 rounded-full">{count(t.key)}</span>}
            </button>
          ))}
        </div>
      </div>
      {loading ? <Spinner /> : error ? <ErrorState message={error.message} retry={reload} /> : (
        <div className="p-5 space-y-5">
          <p className="text-xs text-muted font-medium">{TABS.find((t) => t.key === tab)!.hint}</p>
          {tab === 'history' && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
              {HISTORY_FILTERS.map(([k, label]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{label}</Chip>)}
            </div>
          )}
          {tab === 'incoming' && (lists.incoming.length ? <>
            <Group title="Needs your reply" items={lists.incoming.filter((e) => e.status === 'pending')} />
            <Group title="Accepted · waiting for pickup" items={lists.incoming.filter((e) => e.status === 'accepted')} />
          </> : <Empty icon="box" title="No open requests" body="When neighbours request produce you've shared, they'll appear here." action={<Button variant="secondary" onClick={() => nav('/share')}>Share produce</Button>} />)}
          {tab === 'outgoing' && (lists.outgoing.length ? <>
            <Group title="Ready for pickup" items={lists.outgoing.filter((e) => e.status === 'accepted')} />
            <Group title="Waiting for a reply" items={lists.outgoing.filter((e) => e.status === 'pending')} />
          </> : <Empty icon="search" title="You haven't requested anything" body="Browse what your neighbours have extra today." action={<Button variant="secondary" onClick={() => nav('/explore')}>Explore produce</Button>} />)}
          {tab === 'history' && (history.length
            ? <div className="space-y-3">{history.map((e) => <ExRow key={e.id} e={e} />)}</div>
            : <Empty icon="swap" title={filter === 'all' ? 'No past exchanges yet' : 'Nothing here'} body="Completed, cancelled and expired exchanges show up here." />)}
        </div>
      )}
    </div>
  );
}
