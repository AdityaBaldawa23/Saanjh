import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { kg, useQuery } from '../lib';
import type { Listing } from '../types';
import { ListingCard } from '../components/ListingCard';
import { Button, Card, Empty, ErrorState, Icon, Spinner } from '../components/ui';

function Section({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <div className="px-5 flex items-center justify-between mb-3">
        <h2 className="font-bold text-[17px]">{title}</h2>
        {to && <Link to={to} className="text-sm font-semibold text-leaf">See all</Link>}
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  const { me } = useSession();
  const nav = useNavigate();
  const listings = useQuery<Listing[]>('/listings');
  const stats = useQuery<any>('/society/stats');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const all = listings.data ?? [];
  const others = all.filter((l) => !l.is_mine);
  const expiring = [...others].filter((l) => l.available_until - Date.now() < 24 * 3_600_000).sort((a, b) => a.available_until - b.available_until);
  const recent = others.slice(0, 6);
  const w = me!.wallet;

  return (
    <div>
      <header className="px-5 pt-6 flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted font-medium">{greet}, {me!.user.name.split(' ')[0]}</p>
          <h1 className="text-[22px] font-extrabold leading-tight truncate">{me!.membership!.society_name}</h1>
        </div>
        <Link to="/notifications" className="relative size-11 rounded-full bg-white shadow-card grid place-items-center shrink-0" aria-label="Notifications">
          <Icon name="bell" />
          {me!.unread_notifications > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-tomato text-white text-[11px] font-bold grid place-items-center">{me!.unread_notifications}</span>}
        </Link>
      </header>

      {me!.admin_todo && (me!.admin_todo.pending_members > 0 || me!.admin_todo.open_reports > 0) && (
        <div className="px-5 mt-4">
          <Link to="/admin" className="flex items-center gap-3 rounded-2xl bg-honey-soft text-earth px-4 py-3">
            <Icon name="shield" size={20} />
            <span className="flex-1 text-sm font-semibold">
              {[me!.admin_todo.pending_members && `${me!.admin_todo.pending_members} resident${me!.admin_todo.pending_members === 1 ? '' : 's'} to verify`,
                me!.admin_todo.open_reports && `${me!.admin_todo.open_reports} open report${me!.admin_todo.open_reports === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </span>
            <Icon name="chevron" size={18} />
          </Link>
        </div>
      )}

      <div className="px-5 mt-5">
        <Link to="/wallet" className="block rounded-3xl bg-forest text-white p-5 relative overflow-hidden">
          <div className="absolute -right-8 -top-10 size-40 rounded-full bg-leaf/40" />
          <div className="absolute right-10 -bottom-14 size-28 rounded-full bg-honey/25" />
          <div className="relative">
            <p className="text-mint/80 text-sm font-medium flex items-center gap-1.5"><Icon name="wallet" size={18} />Community credits</p>
            <p className="text-4xl font-extrabold mt-1 tracking-tight">{w.balance}</p>
            <div className="flex gap-4 mt-3 text-xs text-mint/90">
              <span>+{w.total_earned} earned</span><span>−{w.total_spent} spent</span>{w.held > 0 && <span>{w.held} on hold</span>}
            </div>
          </div>
        </Link>
      </div>

      <div className="px-5 mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => nav('/share')} className="text-left rounded-3xl bg-white shadow-card p-4">
          <span className="size-10 rounded-2xl bg-mint text-forest grid place-items-center"><Icon name="plus" /></span>
          <p className="font-bold mt-3">Share extra</p><p className="text-xs text-muted">Takes under a minute</p>
        </button>
        <Link to="/community" className="rounded-3xl bg-white shadow-card p-4">
          <span className="size-10 rounded-2xl bg-honey-soft text-earth grid place-items-center"><Icon name="chart" /></span>
          <p className="font-bold mt-3">{stats.data ? kg(stats.data.grams) : '—'}</p><p className="text-xs text-muted">saved by your society</p>
        </Link>
      </div>

      {listings.loading ? <Spinner /> : listings.error ? <ErrorState message={listings.error.message} retry={listings.reload} /> : (
        <>
          {expiring.length > 0 && (
            <Section title="Collect soon" to="/explore?sort=expiring">
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-2">{expiring.slice(0, 8).map((l) => <ListingCard key={l.id} l={l} wide />)}</div>
            </Section>
          )}
          <Section title="Recently shared" to="/explore">
            {recent.length ? (
              <div className="grid grid-cols-2 gap-3 px-5">{recent.map((l) => <ListingCard key={l.id} l={l} />)}</div>
            ) : (
              <Card className="mx-5"><Empty title="Nothing shared yet today" body="Be the first. Got a few extra tomatoes or a bunch of coriander?" action={<Button onClick={() => nav('/share')}>Share produce</Button>} /></Card>
            )}
          </Section>
          <Section title="Browse">
            <div className="grid grid-cols-3 gap-3 px-5">
              {[['vegetable', '🥕', 'Vegetables'], ['fruit', '🍌', 'Fruits'], ['leafy', '🌿', 'Greens']].map(([c, e, t]) => (
                <Link key={c} to={`/explore?category=${c}`} className="rounded-3xl bg-white shadow-card py-4 text-center">
                  <span className="text-3xl">{e}</span><p className="text-sm font-semibold mt-1">{t}</p>
                </Link>
              ))}
            </div>
          </Section>
        </>
      )}
      <p className="text-center text-xs text-muted mt-8 px-8">Always check produce before you accept it. Neighbours share in good faith.</p>
    </div>
  );
}
