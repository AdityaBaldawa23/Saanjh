import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { useQuery } from '../lib';
import { Button, Card, Field, Icon, inputCls, Notice, Spinner } from '../components/ui';

interface Society { id: number; name: string; city: string; area: string; members: number }

function AddressFields({ a, setA }: { a: { building: string; wing: string; flat: string }; setA: (v: any) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-3"><Field label="Building / tower"><input className={inputCls} value={a.building} onChange={(e) => setA({ ...a, building: e.target.value })} placeholder="Tower A" required /></Field></div>
      <Field label="Wing"><input className={inputCls} value={a.wing} onChange={(e) => setA({ ...a, wing: e.target.value })} placeholder="East" /></Field>
      <div className="col-span-2"><Field label="Flat no."><input className={inputCls} value={a.flat} onChange={(e) => setA({ ...a, flat: e.target.value })} placeholder="304" required /></Field></div>
    </div>
  );
}

export function Onboarding() {
  const { me, refresh, logout } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [picked, setPicked] = useState<Society | null>(null);
  const [addr, setAddr] = useState({ building: '', wing: '', flat: '' });
  const [soc, setSoc] = useState({ name: '', city: '', area: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useQuery<Society[]>(`/societies?q=${encodeURIComponent(q)}`, [q]);
  const rejected = me?.membership?.status === 'rejected';

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'join') await api.post(`/societies/${picked!.id}/join`, addr);
      else await api.post('/societies', { ...soc, ...addr });
      await refresh();
      nav(mode === 'join' ? '/pending' : '/', { replace: true });
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-dvh px-5 pt-10 pb-10">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-sm font-semibold text-leaf">Hi {me?.user.name.split(' ')[0]} 👋</p>
          <h1 className="text-2xl font-extrabold mt-1">Find your society</h1>
          <p className="text-muted text-sm mt-1">Exchanges happen only between verified neighbours.</p>
        </div>
        <button onClick={logout} className="text-sm text-muted font-medium whitespace-nowrap shrink-0">Sign out</button>
      </div>

      {rejected && <div className="mt-5"><Notice tone="warn">Your request to join {me?.membership?.society_name} wasn't approved{me?.membership?.reject_reason ? `: "${me.membership.reject_reason.replace(/[.\s]+$/, '')}"` : ''}. Check your details and apply again.</Notice></div>}

      <div className="mt-6 grid grid-cols-2 bg-sand rounded-2xl p-1 text-sm font-semibold">
        {(['join', 'create'] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErr(''); }} className={`h-10 rounded-xl transition ${mode === m ? 'bg-white shadow-card text-forest' : 'text-muted'}`}>
            {m === 'join' ? 'Join a society' : 'Register a society'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {err && <Notice tone="error">{err}</Notice>}
        {mode === 'join' ? (
          <>
            {!picked ? (
              <>
                <div className="relative">
                  <Icon name="search" size={20} className="absolute left-4 top-3.5 text-muted" />
                  <input className={`${inputCls} pl-11`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by society name or city" />
                </div>
                {list.loading ? <Spinner /> : (
                  <div className="space-y-2">
                    {list.data?.map((s) => (
                      <button type="button" key={s.id} onClick={() => setPicked(s)} className="w-full text-left">
                        <Card className="p-4 flex items-center gap-3 hover:ring-2 hover:ring-mint transition">
                          <span className="size-11 rounded-2xl bg-mint-soft text-forest grid place-items-center"><Icon name="home" /></span>
                          <span className="flex-1"><span className="block font-bold">{s.name}</span><span className="text-xs text-muted">{[s.area, s.city].filter(Boolean).join(', ')} · {s.members} verified households</span></span>
                          <Icon name="chevron" size={18} className="text-muted" />
                        </Card>
                      </button>
                    ))}
                    {list.data?.length === 0 && <p className="text-sm text-muted text-center py-6">No society found. You can register it instead.</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                <Card className="p-4 flex items-center gap-3">
                  <span className="size-11 rounded-2xl bg-forest text-white grid place-items-center"><Icon name="home" /></span>
                  <span className="flex-1"><span className="block font-bold">{picked.name}</span><span className="text-xs text-muted">{[picked.area, picked.city].filter(Boolean).join(', ')}</span></span>
                  <button type="button" onClick={() => setPicked(null)} className="text-sm font-semibold text-forest">Change</button>
                </Card>
                <AddressFields a={addr} setA={setAddr} />
                <p className="text-xs text-muted">Your society admin will check these details. Neighbours see only your building and wing. Your flat number is shared only with people you exchange with.</p>
                <Button full loading={busy}>Request to join</Button>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Society name"><input className={inputCls} value={soc.name} onChange={(e) => setSoc({ ...soc, name: e.target.value })} placeholder="Green Valley Residency" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Area"><input className={inputCls} value={soc.area} onChange={(e) => setSoc({ ...soc, area: e.target.value })} placeholder="Baner" /></Field>
              <Field label="City"><input className={inputCls} value={soc.city} onChange={(e) => setSoc({ ...soc, city: e.target.value })} placeholder="Pune" required /></Field>
            </div>
            <p className="text-sm font-bold pt-2">Your home</p>
            <AddressFields a={addr} setA={setAddr} />
            <Notice>You'll become this society's admin and verify residents who ask to join.</Notice>
            <Button full loading={busy}>Register society</Button>
          </>
        )}
      </form>
    </div>
  );
}

export function Pending() {
  const { me, refresh, logout } = useSession();
  const [busy, setBusy] = useState(false);
  const m = me?.membership;
  async function check() {
    setBusy(true); await refresh(); setBusy(false);
  }
  return (
    <div className="min-h-dvh px-6 pt-20 text-center">
      <div className="mx-auto size-20 rounded-[28px] bg-honey-soft text-earth grid place-items-center"><Icon name="shield" size={36} /></div>
      <h1 className="text-2xl font-extrabold mt-6">Waiting for verification</h1>
      <p className="text-muted mt-2 leading-relaxed">Your request to join <b className="text-ink">{m?.society_name}</b> as a resident of {[m?.wing, m?.building].filter(Boolean).join(', ')}, Flat {m?.flat} has been sent to the society admin.</p>
      <Card className="p-4 mt-8 text-left text-sm space-y-3">
        {['Request sent', 'Admin verifies your flat', 'Start sharing with neighbours'].map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <span className={`size-7 rounded-full grid place-items-center text-xs font-bold ${i === 0 ? 'bg-forest text-white' : 'bg-sand text-muted'}`}>{i === 0 ? <Icon name="check" size={16} /> : i + 1}</span>
            <span className={i === 0 ? 'font-semibold' : 'text-muted'}>{s}</span>
          </div>
        ))}
      </Card>
      <div className="mt-8 space-y-3">
        <Button full variant="secondary" loading={busy} onClick={check}>Check status</Button>
        <button onClick={logout} className="text-sm text-muted font-medium">Sign out</button>
      </div>
    </div>
  );
}
