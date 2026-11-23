import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { timeAgo, useQuery } from '../lib';
import { Avatar, Button, Card, Empty, ErrorState, Field, inputCls, ProduceImage, Sheet, Spinner, TopBar, useToast } from '../components/ui';

interface MemberRow { id: number; user_id: number; name: string; email: string | null; phone: string | null; building: string; wing: string; flat: string; status: string; role: string; created_at: number; same_flat: number }
interface ReportRow { id: number; reason: string; details: string; status: string; created_at: number; listing_id: number; listing_name: string; photo_url: string; listing_status: string; reporter_name: string; owner_name: string }

function Members() {
  const { data, loading, error, reload } = useQuery<MemberRow[]>('/admin/members');
  const { me } = useSession();
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<MemberRow | null>(null);
  const [reason, setReason] = useState('');
  const act = async (key: string, path: string, body: object, ok: string) => {
    setBusy(key);
    try { await api.post(path, body); toast(ok); setRejecting(null); reload(); refresh(); } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(null); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error.message} retry={reload} />;
  const pending = data!.filter((m) => m.status === 'pending');
  const approved = data!.filter((m) => m.status === 'approved');
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-bold mb-2">Awaiting verification ({pending.length})</h2>
        {!pending.length && <Card className="p-4 text-sm text-muted">No pending requests.</Card>}
        <div className="space-y-2">
          {pending.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex gap-3">
                <Avatar name={m.name} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-muted">{[m.wing, m.building].filter(Boolean).join(', ')} · Flat {m.flat}</p>
                  <p className="text-xs text-muted">{m.email} · applied {timeAgo(m.created_at)}</p>
                  {m.same_flat > 0 && <p className="text-xs text-earth mt-1">{m.same_flat} verified member(s) already live at this flat. Could be family.</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <Button size="sm" variant="secondary" onClick={() => { setReason('We could not verify this flat number.'); setRejecting(m); }}>Reject</Button>
                <Button size="sm" loading={busy === `a${m.id}`} onClick={() => act(`a${m.id}`, `/admin/members/${m.id}/review`, { approve: true }, `${m.name} verified.`)}>Approve</Button>
              </div>
            </Card>
          ))}
        </div>
      </section>
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.name ?? ''}?`}>
        <div className="space-y-4">
          <Field label="Reason (shown to the applicant)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
          <p className="text-xs text-muted">They can correct their details and apply again.</p>
          <Button full variant="danger" loading={busy === 'reject'} onClick={() => rejecting && act('reject', `/admin/members/${rejecting.id}/review`, { approve: false, reason }, 'Request rejected.')}>Reject request</Button>
        </div>
      </Sheet>
      <section>
        <h2 className="font-bold mb-2">Verified residents ({approved.length})</h2>
        <Card className="divide-y divide-line/70">
          {approved.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-3.5">
              <Avatar name={m.name} size={36} />
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{m.name} {m.role === 'admin' && <span className="text-[10px] bg-mint text-forest px-1.5 py-0.5 rounded-full ml-1">ADMIN</span>}</p><p className="text-xs text-muted">{[m.wing, m.building].filter(Boolean).join(', ')} · {m.flat}</p></div>
              {m.user_id !== me!.user.id && (
                <button className="text-xs font-semibold text-forest" disabled={busy === `role${m.id}`}
                  onClick={() => act(`role${m.id}`, `/admin/members/${m.id}/role`, { role: m.role === 'admin' ? 'resident' : 'admin' }, 'Role updated.')}>
                  {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                </button>
              )}
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function Reports() {
  const { data, loading, error, reload } = useQuery<ReportRow[]>('/admin/reports');
  const toast = useToast();
  const act = async (id: number, action: string) => {
    try { await api.post(`/admin/reports/${id}/resolve`, { action }); toast(action === 'dismiss' ? 'Report dismissed.' : 'Listing removed and requests refunded.'); reload(); }
    catch (e) { toast((e as ApiError).message, 'error'); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error.message} retry={reload} />;
  if (!data!.length) return <Empty icon="flag" title="No reports" body="Quality concerns raised by residents will appear here." />;
  return (
    <div className="space-y-2">
      {data!.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex gap-3">
            <ProduceImage src={r.photo_url} category="vegetable" alt={r.listing_name} className="size-14 rounded-xl" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{r.listing_name} <span className="text-muted font-normal text-sm">by {r.owner_name}</span></p>
              <p className="text-sm"><b className="capitalize">{r.reason}</b>{r.details && `: ${r.details}`}</p>
              <p className="text-xs text-muted">Reported by {r.reporter_name} · {timeAgo(r.created_at)} · listing {r.listing_status}</p>
            </div>
          </div>
          {r.status === 'open' ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button size="sm" variant="secondary" onClick={() => act(r.id, 'dismiss')}>Dismiss</Button>
              <Button size="sm" variant="danger" onClick={() => confirm('Remove this listing? Open requests will be refunded.') && act(r.id, 'remove_listing')}>Remove listing</Button>
            </div>
          ) : <p className="text-xs text-muted mt-2 capitalize">{r.status}</p>}
        </Card>
      ))}
    </div>
  );
}

const SETTINGS: [string, string, string][] = [
  ['starter_credits', 'Welcome credits', 'Given once when a resident is verified'],
  ['min_balance', 'Lowest allowed balance', 'Negative values allow a small overdraft'],
  ['min_credits_per_exchange', 'Minimum credits per exchange', ''],
  ['max_active_requests', 'Open requests per resident', ''],
  ['weekly_receive_cap', 'Weekly receiving cap (credits)', ''],
  ['max_receives_without_sharing', 'Pickups allowed before sharing again', ''],
  ['no_show_penalty', 'Missed pickup fee', ''],
  ['strike_limit', 'Strikes before a pause', 'Missed pickups / late cancellations within 30 days'],
  ['restriction_days', 'Pause length (days)', ''],
  ['report_hide_threshold', 'Reports before auto-hiding a listing', ''],
];
function Settings() {
  const { data, loading, error, reload } = useQuery<Record<string, number>>('/admin/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (data) setForm(Object.fromEntries(SETTINGS.map(([k]) => [k, String(data[k])]))); }, [data]);
  if (loading) return <Spinner />;
  if (error) return <ErrorState message={error.message} retry={reload} />;
  async function save() {
    setBusy(true);
    try { await api.patch('/admin/settings', Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]))); toast('Credit rules saved.'); reload(); }
    catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">These rules apply to everyone in your society. Changes affect new requests only.</p>
      {SETTINGS.map(([k, label, hint]) => (
        <Field key={k} label={label} hint={hint || undefined}>
          <input className={inputCls} type="number" inputMode="numeric" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </Field>
      ))}
      <Button full loading={busy} onClick={save}>Save rules</Button>
    </div>
  );
}

export default function Admin() {
  const { me } = useSession();
  const [tab, setTab] = useState<'members' | 'reports' | 'settings'>('members');
  if (me?.membership?.role !== 'admin') return <Navigate to="/profile" replace />;
  return (
    <div>
      <TopBar title="Society admin" />
      <div className="px-5 pt-4">
        <div className="grid grid-cols-3 bg-sand rounded-2xl p-1 text-sm font-semibold">
          {(['members', 'reports', 'settings'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`h-10 rounded-xl capitalize ${tab === t ? 'bg-white shadow-card text-forest' : 'text-muted'}`}>{t === 'settings' ? 'Credit rules' : t}</button>
          ))}
        </div>
        <div className="py-5">{tab === 'members' ? <Members /> : tab === 'reports' ? <Reports /> : <Settings />}</div>
      </div>
    </div>
  );
}
