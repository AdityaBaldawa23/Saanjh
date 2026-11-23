import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { useQuery, whenLabel, timeAgo } from '../lib';
import type { Exchange } from '../types';
import { Avatar, Button, Card, ErrorState, Icon, inputCls, Notice, ProduceImage, Sheet, Spinner, StatusBadge, TopBar, useToast } from '../components/ui';

function Timeline({ e }: { e: Exchange }) {
  const steps = [
    { label: 'Requested', done: true, t: e.created_at },
    { label: 'Accepted', done: !!e.accepted_at, t: e.accepted_at },
    { label: 'Handed over', done: e.owner_confirmed || e.status === 'completed', t: e.owner_confirmed_at },
    { label: 'Received', done: e.requester_confirmed || e.status === 'completed', t: e.requester_confirmed_at },
  ];
  return (
    <div className="flex items-start">
      {steps.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center text-center relative">
          {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 ${s.done ? 'bg-forest' : 'bg-line'}`} />}
          <span className={`relative size-7 rounded-full grid place-items-center ${s.done ? 'bg-forest text-white' : 'bg-white border-2 border-line text-muted'}`}>
            {s.done ? <Icon name="check" size={15} strokeWidth={2.5} /> : <span className="text-xs font-bold">{i + 1}</span>}
          </span>
          <span className={`text-[11px] font-semibold mt-1.5 ${s.done ? 'text-ink' : 'text-muted'}`}>{s.label}</span>
          {s.t && <span className="text-[10px] text-muted">{timeAgo(s.t)}</span>}
        </div>
      ))}
    </div>
  );
}

function closedCopy(e: Exchange): string | null {
  const you = (role: 'giver' | 'receiver') => e.role === role;
  switch (e.status) {
    case 'rejected': return you('giver') ? 'You declined this request.' : 'The contributor declined this request. Your credits were returned.';
    case 'cancelled':
      if (e.close_reason?.startsWith('Declined at pickup')) return you('receiver')
        ? 'You declined the produce at pickup. Your credits were fully refunded and the society admin was notified.'
        : 'Your neighbour declined the produce at pickup after inspecting it. No credits were exchanged.';
      return `Cancelled by ${e.cancelled_by === 'owner' ? (you('giver') ? 'you' : 'the contributor') : e.cancelled_by === 'requester' ? (you('receiver') ? 'you' : 'the requester') : 'the system'}${e.close_reason && !['owner_removed', 'Cancelled by contributor', 'Cancelled by requester'].includes(e.close_reason) ? `: "${e.close_reason}"` : ''}.${you('receiver') ? ' Credits have been returned to your wallet.' : ''}`;
    case 'no_show': return you('receiver') ? 'Marked as not collected. Credits were refunded minus a small missed-pickup fee.' : 'You marked this as not collected. The quantity went back to your listing.';
    case 'expired': return `Closed automatically: ${e.close_reason?.toLowerCase() ?? 'deadline passed'}.${you('receiver') ? ' Credits were returned.' : ''}`;
    case 'completed': return you('giver') ? `You earned ${e.credits} credits. Thank you for sharing!` : 'Enjoy! Share something when you have extra.';
    default: return null;
  }
}

export default function ExchangeDetail() {
  const { id } = useParams();
  const { refresh } = useSession();
  const toast = useToast();
  const { data: e, loading, error, reload } = useQuery<Exchange>(`/exchanges/${id}`, [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'cancel' | 'decline' | 'noshow' | null>(null);
  const [reason, setReason] = useState('');

  if (loading) return <><TopBar title="Exchange" /><Spinner /></>;
  if (error || !e) return <><TopBar title="Exchange" /><ErrorState message={error?.message ?? 'Not found'} /></>;

  const giver = e.role === 'giver';
  const act = async (key: string, path: string, ok: string, body: object = {}) => {
    setBusy(key);
    try { await api.post(`/exchanges/${e.id}/${path}`, body); toast(ok); setSheet(null); setReason(''); await Promise.all([reload(), refresh()]); }
    catch (err) { toast((err as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  const pickupStarted = e.produce.pickup_from <= Date.now();
  const closed = closedCopy(e);
  const myConfirm = giver ? e.owner_confirmed : e.requester_confirmed;
  const theirConfirm = giver ? e.requester_confirmed : e.owner_confirmed;

  return (
    <div className="pb-10">
      <TopBar title={giver ? 'Request for your produce' : 'Your request'} />
      <div className="px-5 pt-4 space-y-4">
        <Link to={`/listing/${e.listing_id}`} className="flex gap-4 items-center">
          <ProduceImage src={e.produce.photo_url} emoji={e.produce.emoji} category={e.produce.category} alt={e.produce.name} className="size-20 rounded-2xl" />
          <div className="flex-1">
            <p className="text-xl font-extrabold">{e.quantity_label} {e.produce.name}</p>
            <div className="flex items-center gap-2 mt-1"><StatusBadge status={e.status} /><span className={`text-sm font-bold ${giver ? 'text-leaf' : 'text-earth'}`}>{giver ? '+' : '−'}{e.credits} credits</span></div>
          </div>
        </Link>

        <Card className="p-5"><Timeline e={e} /></Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Avatar name={e.counterparty.name} size={44} />
            <div className="flex-1">
              <p className="text-xs text-muted">{giver ? 'Requested by' : 'Shared by'}</p>
              <p className="font-bold">{e.counterparty.name}</p>
            </div>
          </div>
          <div className="mt-3 rounded-2xl bg-mint-soft p-3.5 text-sm space-y-1.5">
            <p className="flex gap-2"><Icon name="pin" size={18} className="text-forest shrink-0" />
              <span>{e.counterparty.location}{e.counterparty.flat ? <>, <b>Flat {e.counterparty.flat}</b></> : <span className="text-muted"> · flat number shown once accepted</span>}</span></p>
            {!giver && <p className="flex gap-2"><Icon name="clock" size={18} className="text-forest shrink-0" /><span>Collect by <b>{whenLabel(e.produce.available_until)}</b>{!pickupStarted && <> · from {whenLabel(e.produce.pickup_from)}</>}</span></p>}
            {giver && <p className="flex gap-2"><Icon name="clock" size={18} className="text-forest shrink-0" /><span>Your pickup deadline: <b>{whenLabel(e.produce.available_until)}</b></span></p>}
            {e.produce.pickup_note && <p className="flex gap-2"><Icon name="info" size={18} className="text-forest shrink-0" /><span>{e.produce.pickup_note}</span></p>}
          </div>
          {e.message && <p className="text-sm mt-3"><span className="text-muted">{giver ? 'Their note' : 'Your note'}:</span> "{e.message}"</p>}
          {e.owner_note && <p className="text-sm mt-1.5"><span className="text-muted">{giver ? 'Your reply' : 'Their reply'}:</span> "{e.owner_note}"</p>}
        </Card>

        {/* ── Contributor, request pending ── */}
        {e.status === 'pending' && giver && (
          <>
            <Notice>Accepting confirms the booking. {e.counterparty.name} will see your flat number and come to collect.</Notice>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" loading={busy === 'reject'} onClick={() => act('reject', 'reject', 'Declined. Their credits were returned.')}>Decline</Button>
              <Button loading={busy === 'accept'} onClick={() => act('accept', 'accept', 'Accepted! They can now collect.')}>Accept</Button>
            </div>
          </>
        )}

        {/* ── Receiver, request pending ── */}
        {e.status === 'pending' && !giver && (
          <>
            <Notice>{e.credits} credits are on hold. You'll be notified when {e.counterparty.name} accepts. If they don't reply before the deadline, the credits come back.</Notice>
            <Button full variant="secondary" onClick={() => setSheet('cancel')}>Withdraw request</Button>
          </>
        )}

        {/* ── Booking confirmed: both sides confirm the handover ── */}
        {e.status === 'accepted' && (
          <>
            {myConfirm ? (
              <Notice tone="ok">You've confirmed. Waiting for {e.counterparty.name} to confirm too. If they don't, it completes automatically 24 hours after your confirmation.</Notice>
            ) : giver ? (
              <Notice>{theirConfirm ? `${e.counterparty.name} confirmed they received it. Confirm the handover to receive your ${e.credits} credits.` : `When ${e.counterparty.name} collects, tap "Handed over". You earn ${e.credits} credits once the exchange is complete.`}</Notice>
            ) : (
              <Notice tone="warn"><b>Inspect the produce at pickup.</b> If it's spoiled or not as described, don't take it. Tap "Decline produce" for a full refund.</Notice>
            )}
            {!myConfirm && (
              <Button full loading={busy === 'confirm'} onClick={() => act('confirm', 'confirm', theirConfirm ? `Exchange complete${giver ? ` · +${e.credits} credits` : ''}!` : 'Confirmed. Waiting for the other side.')}>
                <Icon name="check" size={18} />{giver ? 'Handed over' : "I've received it"}
              </Button>
            )}
            {giver && !myConfirm && (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" disabled={!pickupStarted || theirConfirm} onClick={() => setSheet('noshow')}>Not collected</Button>
                <Button variant="danger" disabled={theirConfirm} onClick={() => setSheet('cancel')}>Cancel</Button>
              </div>
            )}
            {!giver && !myConfirm && (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setSheet('decline')}>Decline produce</Button>
                <Button variant="danger" onClick={() => setSheet('cancel')}>Can't make it</Button>
              </div>
            )}
          </>
        )}

        {closed && <Notice tone={e.status === 'completed' ? 'ok' : 'info'}>{closed}</Notice>}
      </div>

      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title={e.status === 'pending' ? 'Withdraw request?' : 'Cancel this pickup?'}>
        <div className="space-y-4">
          {e.status === 'accepted'
            ? <Notice tone="warn">This booking is already confirmed. {giver ? `${e.counterparty.name} gets a full refund.` : 'You get a full refund.'} Cancelling confirmed pickups counts toward a temporary booking pause (3 in 30 days).</Notice>
            : <p className="text-sm text-muted">Your {e.credits} credits will be released immediately.</p>}
          <input className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Reason (optional, shared with them)" maxLength={200} />
          <Button full variant="danger" loading={busy === 'cancel'} onClick={() => act('cancel', 'cancel', e.status === 'pending' ? 'Request withdrawn. Credits released.' : 'Pickup cancelled. Credits refunded.', { reason })}>Yes, cancel</Button>
          <Button full variant="ghost" onClick={() => setSheet(null)}>Keep it</Button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'decline'} onClose={() => setSheet(null)} title="Decline the produce?">
        <div className="space-y-4">
          <p className="text-sm text-muted">Use this if the produce wasn't fit to eat or wasn't as described. You get all {e.credits} credits back, there's no penalty, and your society admin is notified.</p>
          <input className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="What was wrong? e.g. mouldy, overripe" maxLength={300} />
          <Button full variant="danger" loading={busy === 'decline'} onClick={() => act('decline', 'decline-at-pickup', 'Declined. Credits refunded and admin notified.', { details: reason })}>Decline produce</Button>
          <Button full variant="ghost" onClick={() => setSheet(null)}>Go back</Button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'noshow'} onClose={() => setSheet(null)} title="Mark as not collected?">
        <div className="space-y-4">
          <p className="text-sm text-muted">{e.counterparty.name} gets their credits back minus a small missed-pickup fee, and it counts as a missed pickup on their record. The quantity goes back to your listing.</p>
          <Button full variant="danger" loading={busy === 'noshow'} onClick={() => act('noshow', 'no-show', 'Marked as not collected.')}>Yes, not collected</Button>
          <Button full variant="ghost" onClick={() => setSheet(null)}>Go back</Button>
        </div>
      </Sheet>
    </div>
  );
}
