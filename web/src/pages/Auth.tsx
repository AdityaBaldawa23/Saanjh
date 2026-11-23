import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import type { Me } from '../types';
import { Button, Field, Icon, inputCls, Notice } from '../components/ui';

function Brand() {
  return (
    <div className="pt-14 pb-8 px-6">
      <div className="size-14 rounded-[20px] bg-forest text-mint grid place-items-center mb-6"><Icon name="leaf" size={28} strokeWidth={2} /></div>
      <h1 className="text-[30px] leading-tight font-extrabold tracking-tight">Saanjha</h1>
      <p className="text-muted mt-2 text-[15px] leading-relaxed">Give what you have. Take what you need.<br />Keep food within your community.</p>
    </div>
  );
}

export function Login() {
  const { setMe } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { setMe(await api.post<Me>('/auth/login', { email, password })); nav('/', { replace: true }); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-dvh flex flex-col">
      <Brand />
      <form onSubmit={submit} className="px-6 space-y-4 flex-1">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="Email">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button full loading={busy} className="mt-2">Sign in</Button>
        <p className="text-center text-sm text-muted pt-2">New here? <Link to="/register" className="font-semibold text-forest">Create an account</Link></p>
      </form>
      <p className="px-6 py-6 text-xs text-muted text-center">For residents of registered housing societies only.</p>
    </div>
  );
}

export function Register() {
  const { setMe } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      setMe(await api.post<Me>('/auth/register', { name: f.name, email: f.email, password: f.password }));
      nav('/onboarding', { replace: true });
    } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-dvh">
      <Brand />
      <form onSubmit={submit} className="px-6 space-y-4 pb-10">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="Your name"><input className={inputCls} value={f.name} onChange={set('name')} autoComplete="name" placeholder="e.g. Priya Sharma" required /></Field>
        <Field label="Email" hint="Used only to sign in. Never shown to neighbours.">
          <input className={inputCls} type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <input className={inputCls} type="password" value={f.password} onChange={set('password')} minLength={8} autoComplete="new-password" placeholder="Minimum 8 characters" required />
        </Field>
        <Button full loading={busy}>Continue</Button>
        <p className="text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-semibold text-forest">Sign in</Link></p>
      </form>
    </div>
  );
}
