import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, uploadPhoto } from '../api';
import { CONDITION, rateLabel, useQuery, whenLabel } from '../lib';
import type { Category, Condition, Listing } from '../types';
import { Button, Card, Chip, Field, Icon, inputCls, Notice, Spinner, TopBar, useToast } from '../components/ui';

interface CatalogItem { id: number; name: string; category: Category; unit_type: 'weight' | 'piece'; rate: number; emoji: string }
const DEFAULT_RATE = { vegetable: 20, fruit: 24, leafy: 80 };
const POPULAR = ['Tomato', 'Onion', 'Potato', 'Banana', 'Coriander', 'Lemon', 'Apple', 'Spinach', 'Mango', 'Capsicum'];
const PICKUP = ['Anytime today', 'Mornings 8–11', 'Evenings 6–9', 'Left with security'];

function at(daysAhead: number, hour: number) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return d.getTime();
}
function deadlineOptions() {
  const tonight = at(0, 21);
  const opts: { label: string; t: number }[] = [];
  if (tonight - Date.now() > 60 * 60_000) opts.push({ label: 'Tonight, 9 pm', t: tonight });
  opts.push({ label: 'Tomorrow, 9 pm', t: at(1, 21) }, { label: 'In 2 days', t: at(2, 21) }, { label: 'In 4 days', t: at(4, 21) });
  return opts;
}
const toLocalInput = (t: number) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function ShareProduce() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const toast = useToast();
  const catalog = useQuery<CatalogItem[]>('/catalog');
  const [params] = useSearchParams();
  const from = params.get('from'); // "Share again" pre-fills from an older listing
  const sourceId = editing ? id : from;
  const existing = useQuery<Listing>(sourceId ? `/listings/${sourceId}` : null, [sourceId]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('vegetable');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<'g' | 'kg' | 'pcs'>('kg');
  const [condition, setCondition] = useState<Condition | ''>('');
  const options = useMemo(deadlineOptions, []);
  const [deadline, setDeadline] = useState<number>(options[0].t);
  const [custom, setCustom] = useState(false);
  const [pickupNote, setPickupNote] = useState('');
  const [notes, setNotes] = useState('');
  const [purchase, setPurchase] = useState('');
  const [declared, setDeclared] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l = existing.data;
    if (!l) return;
    setPhoto(l.photo_url); setName(l.name); setCategory(l.category); setUnit(l.display_unit);
    setQuantity(String(l.display_unit === 'kg' ? l.qty_total / 1000 : l.qty_total));
    setPickupNote(l.pickup_note); setNotes(l.notes); setPurchase(l.purchase_date ?? '');
    if (l.notes || l.purchase_date) setMore(true);
    if (editing) { setCondition(l.condition); setDeadline(l.available_until); setCustom(true); setDeclared(true); }
    else setQuantity(String(l.display_unit === 'kg' ? l.qty_available / 1000 || l.qty_total / 1000 : l.qty_available || l.qty_total));
  }, [existing.data, editing]);

  const match = catalog.data?.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const suggestions = useMemo(() => {
    const items = catalog.data ?? [];
    const q = name.trim().toLowerCase();
    if (!q) return POPULAR.map((n) => items.find((i) => i.name === n)).filter(Boolean) as CatalogItem[];
    return items.filter((i) => i.name.toLowerCase().includes(q) && i.name.toLowerCase() !== q).slice(0, 8);
  }, [catalog.data, name]);

  function pick(c: CatalogItem) {
    setName(c.name); setCategory(c.category);
    setUnit(c.unit_type === 'piece' ? 'pcs' : c.category === 'leafy' ? 'g' : 'kg');
  }

  const unitType = unit === 'pcs' ? 'piece' : 'weight';
  const rate = match && match.unit_type === unitType ? match.rate : unitType === 'weight' ? DEFAULT_RATE[match?.category ?? category] : 3;

  async function onFile(f?: File) {
    if (!f) return;
    setUploading(true); setErr('');
    try { setPhoto(await uploadPhoto(f)); } catch (e) { setErr((e as ApiError).message); } finally { setUploading(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!photo) return setErr('Add a photo so neighbours can see the produce.');
    if (!condition) return setErr('Choose the condition of the produce.');
    if (!declared) return setErr('Please confirm the declaration at the bottom.');
    setBusy(true);
    const body = { quantity: Number(quantity), unit, photo_url: photo, condition, available_until: deadline, pickup_note: pickupNote, notes, purchase_date: purchase || null };
    try {
      const l = editing
        ? await api.patch<Listing>(`/listings/${id}`, body)
        : await api.post<Listing>('/listings', { ...body, name, category, declared });
      toast(editing ? 'Listing updated.' : 'Shared with your society! 🌱');
      nav(`/listing/${l.id}`, { replace: true });
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }

  if (sourceId && existing.loading) return <Spinner />;

  return (
    <div>
      <TopBar title={editing ? 'Edit listing' : 'Share produce'} back={editing} />
      <form onSubmit={submit} className="px-5 pt-4 pb-8 space-y-6">
        {from && existing.data && <Notice>Re-sharing {existing.data.name}. Please check the photo and condition are still accurate.</Notice>}
        {/* Photo */}
        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className={`w-full aspect-[16/10] rounded-3xl overflow-hidden grid place-items-center relative ${photo ? '' : 'border-2 border-dashed border-leaf/40 bg-mint-soft'}`}>
            {photo ? <img src={photo} alt="Your produce" className="w-full h-full object-cover" /> : (
              <span className="text-forest text-center">
                <span className="mx-auto size-14 rounded-2xl bg-white grid place-items-center shadow-card"><Icon name="camera" size={28} /></span>
                <span className="block font-bold mt-3">Add a photo</span>
                <span className="block text-xs text-muted mt-0.5">Required. Show the actual produce clearly.</span>
              </span>
            )}
            {uploading && <span className="absolute inset-0 bg-white/70 grid place-items-center"><span className="size-7 rounded-full border-[3px] border-forest border-r-transparent animate-spin" /></span>}
            {photo && !uploading && <span className="absolute bottom-3 right-3 h-8 px-3 rounded-full bg-white/90 text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="camera" size={16} />Retake</span>}
          </button>
        </div>

        {/* What */}
        <div>
          <Field label="What are you sharing?">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tomato" required disabled={editing} maxLength={40} />
          </Field>
          {!editing && suggestions.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2.5 -mx-5 px-5">
              {suggestions.map((s) => <Chip key={s.id} onClick={() => pick(s)}>{s.emoji} {s.name}</Chip>)}
            </div>
          )}
          {!editing && name && !match && (
            <div className="flex gap-2 mt-3">
              {(['vegetable', 'fruit', 'leafy'] as const).map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c === 'leafy' ? 'Greens & herbs' : c === 'fruit' ? 'Fruit' : 'Vegetable'}</Chip>)}
            </div>
          )}
        </div>

        {/* Quantity */}
        <div>
          <span className="block text-sm font-semibold mb-1.5">How much is extra?</span>
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1`} type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={unit === 'kg' ? '1.5' : unit === 'g' ? '250' : '6'} required />
            <div className="flex bg-sand rounded-2xl p-1">
              {(['g', 'kg', 'pcs'] as const).map((u) => (
                <button type="button" key={u} disabled={editing && (u === 'pcs') !== (unit === 'pcs')} onClick={() => setUnit(u)}
                  className={`w-14 rounded-xl text-sm font-semibold disabled:opacity-30 ${unit === u ? 'bg-white shadow-card text-forest' : 'text-muted'}`}>{u}</button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted mt-1.5">Neighbours can take part of it. You earn {rateLabel(unitType, rate)} when they collect.</p>
        </div>

        {/* Condition */}
        <div>
          <span className="block text-sm font-semibold mb-2">Condition</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CONDITION) as Condition[]).map((c) => (
              <button type="button" key={c} onClick={() => setCondition(c)}
                className={`rounded-2xl p-3 text-left border transition ${condition === c ? 'border-forest bg-mint-soft ring-2 ring-mint' : 'border-line bg-white'}`}>
                <span className="block font-bold text-sm">{CONDITION[c].label}</span>
                <span className="block text-[11px] text-muted leading-snug mt-0.5">{CONDITION[c].hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Deadline */}
        <div>
          <span className="block text-sm font-semibold mb-2">Collect by</span>
          <div className="flex gap-2 flex-wrap">
            {options.map((o) => <Chip key={o.label} active={!custom && deadline === o.t} onClick={() => { setCustom(false); setDeadline(o.t); }}>{o.label}</Chip>)}
            <Chip active={custom} onClick={() => setCustom(true)}>Pick a time</Chip>
          </div>
          {custom && <input type="datetime-local" className={`${inputCls} mt-2.5`} value={toLocalInput(deadline)} min={toLocalInput(Date.now())} onChange={(e) => e.target.value && setDeadline(new Date(e.target.value).getTime())} />}
          <p className="text-xs text-muted mt-1.5">Listing closes automatically {whenLabel(deadline)}.</p>
        </div>

        {/* Pickup */}
        <div>
          <Field label="When can neighbours pick up?">
            <input className={inputCls} value={pickupNote} onChange={(e) => setPickupNote(e.target.value)} maxLength={200} placeholder="e.g. After 6 pm, ring the bell" />
          </Field>
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2.5 -mx-5 px-5">{PICKUP.map((p) => <Chip key={p} active={pickupNote === p} onClick={() => setPickupNote(p)}>{p}</Chip>)}</div>
        </div>

        {/* More */}
        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="text-sm font-semibold text-forest">+ Add purchase date or notes</button>
        ) : (
          <div className="space-y-4">
            <Field label="Purchase date (optional)"><input type="date" className={inputCls} value={purchase} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPurchase(e.target.value)} /></Field>
            <Field label="Notes (optional)"><textarea className={`${inputCls} h-24 py-3`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Variety, ripeness, anything useful" /></Field>
          </div>
        )}

        {/* Declaration */}
        {!editing && (
          <Card className="p-4">
            <label className="flex gap-3 cursor-pointer">
              <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="accent-forest size-5 mt-0.5 shrink-0" />
              <span className="text-sm leading-relaxed">I confirm this produce is <b>clean, not spoiled or visibly damaged</b>, and that I'd be happy to eat it myself. The photo shows the actual item.</span>
            </label>
          </Card>
        )}

        {err && <Notice tone="error">{err}</Notice>}
        <Button full loading={busy} disabled={uploading}>{editing ? 'Save changes' : 'Share with neighbours'}</Button>
        {!editing && <p className="text-xs text-muted text-center -mt-2">Please don't list spoiled, cooked or opened packaged food.</p>}
      </form>
    </div>
  );
}
