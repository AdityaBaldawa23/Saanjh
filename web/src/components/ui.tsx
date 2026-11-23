import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ExStatus, Category } from '../types';
import { initials } from '../lib';

// ───────── Icons (1.75px stroke, 24 grid) ─────────
const P: Record<string, ReactNode> = {
  home: <><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  swap: <><path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.75" /><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  wallet: <><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M16 12.5h1.5M3.5 9.5h17" /></>,
  back: <path d="M15 5 8 12l7 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 1.5" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z" /><circle cx="12" cy="10" r="2.3" /></>,
  flag: <><path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  leaf: <><path d="M5 19c0-8 5-13.5 14-14-0.5 9-6 14-14 14Z" /><path d="M5 19 13 11" /></>,
  chart: <><path d="M4.5 19.5h15" /><path d="M7.5 16v-4M12 16V8M16.5 16v-6" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.2" /></>,
  logout: <><path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" /><path d="M10.5 12H20m-3-3 3 3-3 3" /></>,
  edit: <><path d="M4.5 19.5h4L19 9l-4-4L4.5 15.5z" /></>,
  box: <><path d="M4 8 12 4l8 4v8l-8 4-8-4z" /><path d="m4 8 8 4 8-4M12 12v8" /></>,
};
export function Icon({ name, size = 22, className = '', strokeWidth = 1.75 }: { name: keyof typeof P | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>{P[name]}</svg>
  );
}

// ───────── Buttons ─────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'honey'; loading?: boolean; full?: boolean; size?: 'md' | 'sm' };
export function Button({ variant = 'primary', loading, full, size = 'md', className = '', children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-forest text-white hover:bg-forest-dark active:bg-forest-dark disabled:bg-forest/40',
    secondary: 'bg-white text-forest border border-line hover:bg-mint-soft disabled:text-muted',
    ghost: 'text-forest hover:bg-mint-soft',
    danger: 'bg-white text-tomato border border-tomato/30 hover:bg-tomato-soft',
    honey: 'bg-honey text-ink hover:brightness-95',
  }[variant];
  const s = size === 'sm' ? 'h-9 px-3.5 text-sm rounded-xl' : 'h-12 px-5 text-[15px] rounded-2xl';
  return (
    <button {...rest} disabled={disabled || loading}
      className={`${s} ${v} ${full ? 'w-full' : ''} inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed ${className}`}>
      {loading && <span className="size-4 rounded-full border-2 border-current border-r-transparent animate-spin" />}
      {children}
    </button>
  );
}

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`bg-white rounded-3xl shadow-card ${className}`}>{children}</div>;

// ───────── Form fields ─────────
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-ink mb-1.5">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1.5">{hint}</span>}
      {error && <span className="block text-xs text-tomato mt-1.5">{error}</span>}
    </label>
  );
}
export const inputCls = 'w-full h-12 px-4 rounded-2xl bg-white border border-line text-[15px] placeholder:text-muted/70 outline-none focus:border-leaf focus:ring-4 focus:ring-mint transition';

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 h-9 px-4 rounded-full text-sm font-medium border transition ${active ? 'bg-forest text-white border-forest' : 'bg-white text-ink border-line hover:border-leaf'}`}>
      {children}
    </button>
  );
}

// ───────── Produce image ─────────
const TINT: Record<Category, string> = { fruit: 'bg-honey-soft', vegetable: 'bg-mint-soft', leafy: 'bg-mint' };
export function ProduceImage({ src, emoji, category, className = '', alt }: { src?: string | null; emoji?: string | null; category: Category; className?: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={`object-cover ${TINT[category]} ${className}`} />;
  return <div className={`grid place-items-center ${TINT[category]} ${className}`} aria-label={alt}><span className="text-5xl">{emoji ?? '🧺'}</span></div>;
}

export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  return src
    ? <img src={src} alt="" className="rounded-full object-cover bg-mint" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-mint text-forest grid place-items-center font-bold" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name || '?')}</div>;
}

// ───────── Status ─────────
const STATUS: Record<ExStatus, { label: string; cls: string }> = {
  pending: { label: 'Awaiting reply', cls: 'bg-honey-soft text-earth' },
  accepted: { label: 'Ready for pickup', cls: 'bg-mint text-forest' },
  completed: { label: 'Completed', cls: 'bg-forest text-white' },
  rejected: { label: 'Declined', cls: 'bg-sand text-muted' },
  cancelled: { label: 'Cancelled', cls: 'bg-sand text-muted' },
  no_show: { label: 'Not collected', cls: 'bg-tomato-soft text-tomato' },
  expired: { label: 'Expired', cls: 'bg-sand text-muted' },
};
export const StatusBadge = ({ status }: { status: ExStatus }) =>
  <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold ${STATUS[status].cls}`}>{STATUS[status].label}</span>;

export function CreditPill({ value, tone = 'honey' }: { value: number | string; tone?: 'honey' | 'mint' }) {
  return (
    <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-bold ${tone === 'honey' ? 'bg-honey-soft text-earth' : 'bg-mint text-forest'}`}>
      <span className="size-3.5 rounded-full bg-honey grid place-items-center text-[8px] text-ink">₵</span>{value}
    </span>
  );
}

// ───────── Layout ─────────
export function TopBar({ title, back = true, right }: { title?: string; back?: boolean; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 bg-cream/90 backdrop-blur border-b border-line/60">
      <div className="h-14 px-2 flex items-center gap-1">
        {back ? (
          <button onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} className="size-10 grid place-items-center rounded-full hover:bg-sand" aria-label="Back">
            <Icon name="back" />
          </button>
        ) : <span className="w-3" />}
        <h1 className="flex-1 font-bold text-[17px] truncate">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function Empty({ icon = 'leaf', title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="mx-auto size-14 rounded-2xl bg-mint text-forest grid place-items-center mb-4"><Icon name={icon} size={26} /></div>
      <p className="font-bold">{title}</p>
      {body && <p className="text-sm text-muted mt-1 max-w-xs mx-auto">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const Spinner = () => (
  <div className="py-16 grid place-items-center"><span className="size-7 rounded-full border-[3px] border-forest border-r-transparent animate-spin" /></div>
);

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <Empty icon="info" title="Couldn't load this" body={message} action={retry && <Button variant="secondary" onClick={retry}>Try again</Button>} />;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-cream rounded-t-[28px] p-5 pb-8 pb-safe animate-rise max-h-[92vh] overflow-y-auto">
        <div className="mx-auto w-10 h-1.5 rounded-full bg-line mb-4" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="size-9 rounded-full grid place-items-center hover:bg-sand" aria-label="Close"><Icon name="x" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const cls = { info: 'bg-mint-soft text-forest', warn: 'bg-honey-soft text-earth', error: 'bg-tomato-soft text-tomato', ok: 'bg-mint text-forest' }[tone];
  return <div className={`rounded-2xl px-4 py-3 text-sm flex gap-2.5 ${cls}`}><Icon name="info" size={18} className="shrink-0 mt-px" /><div>{children}</div></div>;
}

export function Row({ to, icon, label, hint, right }: { to: string; icon: string; label: string; hint?: string; right?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-mint-soft/60 transition">
      <span className="size-10 rounded-2xl bg-mint-soft text-forest grid place-items-center"><Icon name={icon} size={20} /></span>
      <span className="flex-1 min-w-0"><span className="block font-semibold text-[15px]">{label}</span>{hint && <span className="block text-xs text-muted truncate">{hint}</span>}</span>
      {right}
      <Icon name="chevron" size={18} className="text-muted" />
    </Link>
  );
}

// ───────── Toasts ─────────
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: 'ok' | 'error'; id: number } | null>(null);
  const show = useCallback((msg: string, tone: 'ok' | 'error' = 'ok') => setT({ msg, tone, id: Date.now() }), []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), 3200); return () => clearTimeout(h); }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div key={t.id} role="status" className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-24 w-[calc(100%-32px)] max-w-sm animate-rise">
          <div className={`rounded-2xl px-4 py-3 text-sm font-medium shadow-lift ${t.tone === 'ok' ? 'bg-forest text-white' : 'bg-tomato text-white'}`}>{t.msg}</div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}
