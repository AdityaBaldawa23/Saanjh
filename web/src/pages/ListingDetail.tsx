import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { CATEGORY_LABEL, CONDITION, formatQty, previewCredits, rateLabel, timeAgo, timeLeft, useQuery, whenLabel } from '../lib';
import type { Eligibility, Listing } from '../types';
import { Avatar, Button, Card, CreditPill, ErrorState, Icon, inputCls, Notice, ProduceImage, Sheet, Spinner, StatusBadge, useToast } from '../components/ui';

function stepFor(l: Listing) {
  if (l.unit_type === 'piece') return 1;
  return l.qty_available <= 500 ? 50 : l.qty_available <= 2000 ? 100 : 250;
}

function RequestSheet({ l, open, onClose, onDone }: { l: Listing; open: boolean; onClose: () => void; onDone: (exId: number) => void }) {
  const step = stepFor(l);
  const defaultQty = l.unit_type === 'piece' ? Math.min(2, l.qty_available) : Math.min(l.qty_available, Math.max(l.min_request, 500));
  const [qty, setQty] = useState(defaultQty);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cost = previewCredits(l.unit_type, l.rate, qty);
  const [el, setEl] = useState<Eligibility | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => api.get<Eligibility>(`/eligibility?credits=${cost}`).then(setEl).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [cost, open]);
  const clamp = (n: number) => Math.max(l.min_request, Math.min(l.qty_available, n));
  const presets = (l.unit_type === 'weight' ? [250, 500, 1000] : [1, 2, 4, 6]).filter((p) => p >= l.min_request && p < l.qty_available);
  const failed = el?.checks.find((c) => !c.ok);
  const toast = useToast();

  async function submit() {
    setBusy(true); setErr('');
    try {
      const ex = await api.post<{ id: number }>(`/listings/${l.id}/request`, { quantity: qty, message: msg });
      toast(`Requested! ${cost} credits on hold until ${l.contributor.first_name} replies.`);
      onDone(ex.id);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.message);
      if (ae.code === 'insufficient_quantity' && ae.details?.available !== undefined) setQty(Math.min(qty, ae.details.available));
    } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Request ${l.name}`}>
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold mb-2">How much do you need?</p>
          <div className="flex items-center justify-between bg-white rounded-2xl border border-line p-2">
            <button onClick={() => setQty(clamp(qty - step))} disabled={qty <= l.min_request} className="size-11 rounded-xl bg-mint-soft text-forest text-2xl font-bold disabled:opacity-40" aria-label="Less">−</button>
            <span className="text-2xl font-extrabold tabular-nums">{formatQty(l.unit_type, qty)}</span>
            <button onClick={() => setQty(clamp(qty + step))} disabled={qty >= l.qty_available} className="size-11 rounded-xl bg-mint-soft text-forest text-2xl font-bold disabled:opacity-40" aria-label="More">+</button>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {presets.map((p) => <button key={p} onClick={() => setQty(p)} className={`h-8 px-3 rounded-full text-sm font-medium border ${qty === p ? 'bg-forest text-white border-forest' : 'bg-white border-line'}`}>{formatQty(l.unit_type, p)}</button>)}
            <button onClick={() => setQty(l.qty_available)} className={`h-8 px-3 rounded-full text-sm font-medium border ${qty === l.qty_available ? 'bg-forest text-white border-forest' : 'bg-white border-line'}`}>All ({formatQty(l.unit_type, l.qty_available)})</button>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted">{formatQty(l.unit_type, qty)} × {rateLabel(l.unit_type, l.rate)}</span>
            <span className="text-xl font-extrabold">{cost} credits</span>
          </div>
          {el?.limits && <p className="text-xs text-muted mt-2">You have {el.limits.balance} credits. After this request: {el.limits.balance - cost}.</p>}
        </Card>

        <label className="block">
          <span className="text-sm font-semibold">Note for {l.contributor.first_name} <span className="text-muted font-normal">(optional)</span></span>
          <input className={`${inputCls} mt-1.5`} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="e.g. I can pick up after 7 pm" />
        </label>

        {failed ? <Notice tone="warn"><b>{failed.label}:</b> {failed.detail}</Notice> : err ? <Notice tone="error">{err}</Notice> : (
          <p className="text-xs text-muted">Credits are held now and spent only when {l.contributor.first_name} accepts. If they decline or the listing expires, you get them back.</p>
        )}
        <Button full loading={busy} disabled={!!failed} onClick={submit}>Request · {cost} credits</Button>
      </div>
    </Sheet>
  );
}

const REASONS = [['spoiled', 'Spoiled or rotten'], ['misdescribed', 'Not as described'], ['unsafe', 'Unsafe or contaminated'], ['inappropriate', 'Not produce / inappropriate'], ['other', 'Something else']] as const;
function ReportSheet({ l, open, onClose, onDone }: { l: Listing; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  async function submit() {
    setBusy(true); setErr('');
    try { await api.post(`/listings/${l.id}/report`, { reason, details }); toast('Thanks. Your society admin has been notified.'); onDone(); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Report a quality concern">
      <div className="space-y-2">
        {REASONS.map(([v, t]) => (
          <label key={v} className={`flex items-center gap-3 p-3.5 rounded-2xl border bg-white cursor-pointer ${reason === v ? 'border-forest ring-2 ring-mint' : 'border-line'}`}>
            <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} className="accent-forest size-4" />
            <span className="text-[15px] font-medium">{t}</span>
          </label>
        ))}
        <textarea className={`${inputCls} h-24 py-3 mt-2`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={300} placeholder="What did you notice? (optional)" />
        {err && <Notice tone="error">{err}</Notice>}
        <Button full variant="danger" className="mt-2" disabled={!reason} loading={busy} onClick={submit}>Send report</Button>
        <p className="text-xs text-muted text-center">Reports are private. Several reports hide a listing automatically until an admin reviews it.</p>
      </div>
    </Sheet>
  );
}

function OwnerPanel({ l, reload }: { l: Listing; reload: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); reload(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const open = ['active', 'paused'].includes(l.status);
  const pending = l.requests?.filter((r) => r.status === 'pending') ?? [];
  const others = l.requests?.filter((r) => r.status !== 'pending') ?? [];
  return (
    <div className="space-y-4">
      {l.status === 'hidden' && <Notice tone="warn">This listing is hidden while a society admin reviews quality reports.</Notice>}
      {['expired', 'completed'].includes(l.status) && (
        <Card className="p-4">
          <p className="text-sm">{l.status === 'expired' ? "The collection deadline passed. Still fresh? Share it again in one tap." : 'Everything was collected. Have more of this?'}</p>
          <Button size="sm" className="mt-3" onClick={() => nav(`/share?from=${l.id}`)}>Share again</Button>
        </Card>
      )}
      <div>
        <h3 className="font-bold mb-2">Requests {pending.length > 0 && <span className="ml-1 text-xs bg-honey text-ink px-2 py-0.5 rounded-full">{pending.length} new</span>}</h3>
        {l.requests?.length === 0 && <Card className="p-4 text-sm text-muted">No requests yet. Neighbours will see this in their marketplace.</Card>}
        <div className="space-y-2">
          {[...pending, ...others].map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={r.requester_name} size={38} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold truncate">{r.requester_name}</p><StatusBadge status={r.status} /></div>
                  <p className="text-sm text-muted">{formatQty(l.unit_type, r.quantity)} · {r.credits} credits · {r.location}{r.flat ? `, Flat ${r.flat}` : ''}</p>
                  {r.message && <p className="text-sm mt-1.5 bg-sand rounded-xl px-3 py-2">"{r.message}"</p>}
                </div>
              </div>
              {r.status === 'pending' ? (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button size="sm" variant="secondary" loading={busy === `r${r.id}`} onClick={() => act(`r${r.id}`, () => api.post(`/exchanges/${r.id}/reject`), 'Request declined. Credits returned to them.')}>Decline</Button>
                  <Button size="sm" loading={busy === `a${r.id}`} onClick={() => act(`a${r.id}`, () => api.post(`/exchanges/${r.id}/accept`), 'Accepted! They can now come and collect.')}>Accept</Button>
                </div>
              ) : r.status === 'accepted' && (
                <Link to={`/exchanges/${r.id}`} className="block mt-3 text-sm font-semibold text-forest">Manage pickup →</Link>
              )}
            </Card>
          ))}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="secondary" onClick={() => nav(`/listing/${l.id}/edit`)}><Icon name="edit" size={16} />Edit</Button>
          <Button size="sm" variant="secondary" loading={busy === 'pause'} onClick={() => act('pause', () => api.post(`/listings/${l.id}/status`, { status: l.status === 'paused' ? 'active' : 'paused' }), l.status === 'paused' ? 'Listing is live again.' : 'Paused. No new requests until you resume.')}>
            {l.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="danger" loading={busy === 'remove'} onClick={() => {
            const n = l.requests?.filter((r) => ['pending', 'accepted'].includes(r.status)).length ?? 0;
            if (confirm(n ? `Remove this listing? ${n} open request(s) will be cancelled and refunded. Cancelling confirmed pickups counts against your record.` : 'Remove this listing?'))
              act('remove', () => api.post(`/listings/${l.id}/status`, { status: 'removed' }), 'Listing removed.');
          }}>Remove</Button>
        </div>
      )}
    </div>
  );
}

export default function ListingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { refresh } = useSession();
  const { data: l, loading, error, reload } = useQuery<Listing>(`/listings/${id}`, [id]);
  const [sheet, setSheet] = useState<'request' | 'report' | null>(null);

  if (loading) return <Spinner />;
  if (error || !l) return <div><div className="h-14" /><ErrorState message={error?.message ?? 'Not found'} /><div className="px-5"><Button full variant="secondary" onClick={() => nav('/')}>Back to home</Button></div></div>;

  const available = l.status === 'active' && l.qty_available > 0 && l.available_until > Date.now();
  const pickupStarted = l.pickup_from <= Date.now();

  return (
    <div className="pb-32">
      <div className="relative">
        <ProduceImage src={l.photo_url} emoji={l.emoji} category={l.category} alt={l.name} className="w-full aspect-[4/3] max-h-[52vh]" />
        <button onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} className="absolute top-4 left-4 size-10 rounded-full bg-white/90 backdrop-blur grid place-items-center shadow-card" aria-label="Back"><Icon name="back" /></button>
      </div>

      <div className="-mt-6 relative bg-cream rounded-t-[28px] px-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-leaf uppercase tracking-wide">{CATEGORY_LABEL[l.category]}</p>
            <h1 className="text-[26px] font-extrabold leading-tight mt-0.5">{l.name}</h1>
            <p className="text-muted text-sm mt-1">Shared {timeAgo(l.created_at)}</p>
          </div>
          <span className={`shrink-0 h-7 px-3 rounded-full text-xs font-bold inline-flex items-center ${l.condition === 'use_soon' ? 'bg-honey-soft text-earth' : 'bg-mint text-forest'}`}>{CONDITION[l.condition].label}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <Card className="p-4"><p className="text-xs text-muted font-medium">Available</p><p className="text-lg font-extrabold mt-0.5">{formatQty(l.unit_type, l.qty_available)}</p><p className="text-xs text-muted">of {formatQty(l.unit_type, l.qty_total)} shared</p></Card>
          <Card className="p-4"><p className="text-xs text-muted font-medium">Credits</p><p className="text-lg font-extrabold mt-0.5">{l.credits_example}</p><p className="text-xs text-muted">for {l.unit_type === 'weight' ? formatQty('weight', Math.min(500, l.qty_available || 500)) : '1 piece'} · {rateLabel(l.unit_type, l.rate)}</p></Card>
        </div>

        <Card className="mt-3 divide-y divide-line/70">
          <div className="p-4 flex gap-3"><Icon name="clock" className="text-forest shrink-0" />
            <div><p className="font-semibold text-[15px]">Collect by {whenLabel(l.available_until)}</p><p className="text-sm text-muted">{available ? timeLeft(l.available_until) : 'No longer available'}{!pickupStarted && ` · pickup from ${whenLabel(l.pickup_from)}`}</p></div>
          </div>
          {l.pickup_note && <div className="p-4 flex gap-3"><Icon name="pin" className="text-forest shrink-0" /><div><p className="font-semibold text-[15px]">Pickup</p><p className="text-sm text-muted">{l.pickup_note}</p></div></div>}
          {(l.notes || l.purchase_date) && <div className="p-4 flex gap-3"><Icon name="info" className="text-forest shrink-0" /><div>
            {l.notes && <p className="text-[15px]">{l.notes}</p>}
            {l.purchase_date && <p className="text-sm text-muted mt-0.5">Bought on {new Date(l.purchase_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
          </div></div>}
        </Card>

        <Card className="mt-3 p-4 flex items-center gap-3">
          <Avatar name={l.contributor.first_name} src={l.contributor.avatar_url} size={44} />
          <div className="flex-1"><p className="font-bold">{l.is_mine ? 'You' : l.contributor.first_name}</p><p className="text-sm text-muted">{l.contributor.location} · {l.contributor.shares} successful share{l.contributor.shares === 1 ? '' : 's'}</p></div>
          <Icon name="shield" className="text-leaf" />
        </Card>

        <div className="mt-6">
          {l.is_mine ? <OwnerPanel l={l} reload={reload} /> : (
            <>
              <Notice>Inspect the produce when you collect it. You can decline it at the door if it isn't as described. Neighbours share in good faith; Saanjha doesn't guarantee food safety.</Notice>
              {!l.reported_by_me ? (
                <button onClick={() => setSheet('report')} className="mt-4 mx-auto flex items-center gap-1.5 text-sm text-muted font-medium"><Icon name="flag" size={16} />Report a quality concern</button>
              ) : <p className="mt-4 text-center text-sm text-muted">You've reported this listing.</p>}
            </>
          )}
        </div>
      </div>

      {!l.is_mine && (
        <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto z-30 bg-white/95 backdrop-blur border-t border-line px-5 pt-3 pb-4 pb-safe">
          {l.my_request ? (
            <Link to={`/exchanges/${l.my_request.id}`} className="flex items-center justify-between">
              <span><span className="block text-sm text-muted">Your request · {formatQty(l.unit_type, l.my_request.quantity)}</span><StatusBadge status={l.my_request.status} /></span>
              <Button size="sm">View <Icon name="chevron" size={16} /></Button>
            </Link>
          ) : available ? (
            <div className="flex items-center gap-3">
              <div className="flex-1"><p className="text-xs text-muted">From</p><CreditPill value={`${previewCredits(l.unit_type, l.rate, l.min_request)} credits`} /></div>
              <Button className="flex-[2]" onClick={() => setSheet('request')}>Request</Button>
            </div>
          ) : <Button full disabled>No longer available</Button>}
        </div>
      )}

      {sheet === 'request' && <RequestSheet l={l} open onClose={() => setSheet(null)} onDone={(exId) => { setSheet(null); refresh(); nav(`/exchanges/${exId}`); }} />}
      {sheet === 'report' && <ReportSheet l={l} open onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
