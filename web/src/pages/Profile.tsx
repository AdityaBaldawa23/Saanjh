import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, uploadPhoto } from '../api';
import { useSession } from '../session';
import { formatQty, kg, timeLeft, useQuery } from '../lib';
import type { Listing, Me } from '../types';
import { Avatar, Button, Card, CreditPill, Icon, inputCls, ProduceImage, Row, Sheet, useToast } from '../components/ui';

const LISTING_STATUS: Record<string, string> = { active: 'Live', paused: 'Paused', expired: 'Expired', hidden: 'Under review', completed: 'All collected' };

export default function Profile() {
  const { me, setMe, logout } = useSession();
  const toast = useToast();
  const mine = useQuery<Listing[]>('/listings/mine');
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me!.user.name);
  const [busy, setBusy] = useState(false);
  const { user, membership: m, wallet: w, stats } = me!;

  async function save(patch: object) {
    setBusy(true);
    try { setMe(await api.patch<Me>('/me', patch)); setEditing(false); toast('Profile updated.'); }
    catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="pb-6">
      <div className="px-5 pt-8 flex flex-col items-center text-center">
        <button onClick={() => fileRef.current?.click()} className="relative" aria-label="Change profile photo">
          <Avatar name={user.name} src={user.avatar_url} size={88} />
          <span className="absolute bottom-0 right-0 size-8 rounded-full bg-white shadow-card grid place-items-center text-forest"><Icon name="camera" size={16} /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try { await save({ avatar_url: await uploadPhoto(f) }); } catch (err) { toast((err as ApiError).message, 'error'); }
        }} />
        <h1 className="text-xl font-extrabold mt-3 flex items-center gap-1.5">{user.name}<button onClick={() => setEditing(true)} aria-label="Edit name" className="text-muted"><Icon name="edit" size={16} /></button></h1>
        <p className="text-sm text-muted">{m!.society_name}</p>
        <p className="text-sm text-muted">{[m!.wing, m!.building].filter(Boolean).join(', ')} · Flat {m!.flat}</p>
        <span className="mt-2 inline-flex items-center gap-1 h-7 px-3 rounded-full bg-mint text-forest text-xs font-bold"><Icon name="shield" size={14} strokeWidth={2.2} />Verified {m!.role === 'admin' ? 'admin' : 'resident'}</span>
      </div>

      <div className="px-5 mt-6 grid grid-cols-3 gap-3 text-center">
        <Card className="p-3.5"><p className="text-xl font-extrabold">{stats.shared}</p><p className="text-[11px] text-muted">shared · {kg(stats.shared_grams)}</p></Card>
        <Card className="p-3.5"><p className="text-xl font-extrabold">{stats.received}</p><p className="text-[11px] text-muted">received · {kg(stats.received_grams)}</p></Card>
        <Card className="p-3.5"><p className="text-xl font-extrabold">{w.balance}</p><p className="text-[11px] text-muted">credits</p></Card>
      </div>
      {stats.strikes > 0 && <p className="px-5 mt-3 text-xs text-earth text-center">{stats.strikes} missed pickup{stats.strikes === 1 ? '' : 's'} or late cancellation{stats.strikes === 1 ? '' : 's'} in the last 30 days.</p>}

      <Card className="mx-5 mt-5 overflow-hidden divide-y divide-line/70">
        <Row to="/wallet" icon="wallet" label="Credit wallet" hint="Balance, history and eligibility" right={<CreditPill value={w.balance} />} />
        <Row to="/exchanges" icon="swap" label="Exchange history" hint="Requests, pickups and past exchanges" />
        <Row to="/community" icon="chart" label="Community impact" hint="What your society has saved together" />
        <Row to="/notifications" icon="bell" label="Notifications" right={me!.unread_notifications ? <span className="text-xs font-bold bg-tomato text-white rounded-full px-2 py-0.5">{me!.unread_notifications}</span> : undefined} />
        {m!.role === 'admin' && <Row to="/admin" icon="shield" label="Society admin" hint="Verify residents, review reports, credit rules" />}
      </Card>

      <section className="mt-6">
        <h2 className="px-5 font-bold mb-3">My listings</h2>
        {mine.data?.length ? (
          <div className="px-5 space-y-2">
            {mine.data.map((l) => (
              <Link key={l.id} to={`/listing/${l.id}`} className="flex items-center gap-3 bg-white rounded-2xl shadow-card p-2.5">
                <ProduceImage src={l.photo_url} emoji={l.emoji} category={l.category} alt={l.name} className="size-14 rounded-xl" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{l.name}</p>
                  <p className="text-xs text-muted">{formatQty(l.unit_type, l.qty_available)} left of {formatQty(l.unit_type, l.qty_total)}{l.status === 'active' && ` · ${timeLeft(l.available_until)}`}</p>
                </div>
                <div className="text-right">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${l.status === 'active' ? 'bg-mint text-forest' : 'bg-sand text-muted'}`}>{LISTING_STATUS[l.status] ?? l.status}</span>
                  {!!l.open_requests && <p className="text-[11px] text-earth font-semibold mt-1">{l.open_requests} request{l.open_requests === 1 ? '' : 's'}</p>}
                </div>
              </Link>
            ))}
          </div>
        ) : <p className="px-5 text-sm text-muted">You haven't shared anything yet. <Link to="/share" className="font-semibold text-forest">Share produce</Link></p>}
      </section>

      <div className="px-5 mt-8">
        <p className="text-xs text-muted text-center mb-3">{user.email}. Only visible to you and your society admin.</p>
        <Button full variant="secondary" onClick={logout}><Icon name="logout" size={18} />Sign out</Button>
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <Button full className="mt-4" loading={busy} disabled={!name.trim()} onClick={() => save({ name })}>Save</Button>
      </Sheet>
    </div>
  );
}
