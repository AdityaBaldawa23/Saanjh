import { Link } from 'react-router-dom';
import { formatQty, timeAgo, useQuery } from '../lib';
import type { Eligibility, Txn, Wallet } from '../types';
import { Card, ErrorState, Icon, Spinner, TopBar } from '../components/ui';

interface WalletResp {
  wallet: Wallet; transactions: Txn[]; eligibility: Eligibility;
  recent_contributions: { produce_name: string; quantity: number; unit_type: 'weight' | 'piece'; credits: number; completed_at: number }[];
  settings: { starter_credits: number; min_balance: number; no_show_penalty: number } | null;
}

const TX: Record<string, { label: string; icon: string }> = {
  starter: { label: 'Welcome', icon: 'leaf' }, hold: { label: 'On hold', icon: 'clock' }, release: { label: 'Released', icon: 'swap' },
  spend: { label: 'Spent', icon: 'check' }, refund: { label: 'Refund', icon: 'swap' }, earn: { label: 'Earned', icon: 'leaf' },
  penalty: { label: 'Fee', icon: 'info' }, adjustment: { label: 'Adjustment', icon: 'info' },
};

export default function WalletPage() {
  const { data, loading, error, reload } = useQuery<WalletResp>('/wallet');
  if (loading) return <><TopBar title="Credit wallet" /><Spinner /></>;
  if (error || !data) return <><TopBar title="Credit wallet" /><ErrorState message={error?.message ?? ''} retry={reload} /></>;
  const { wallet: w, eligibility: el } = data;

  return (
    <div>
      <TopBar title="Credit wallet" />
      <div className="px-5 pt-4 pb-8 space-y-4">
        <div className="rounded-3xl bg-forest text-white p-5">
          <p className="text-mint/80 text-sm font-medium">Available credits</p>
          <p className="text-5xl font-extrabold mt-1 tracking-tight">{w.balance}</p>
          {w.held > 0 && <p className="text-sm text-mint mt-1">+ {w.held} on hold for pending requests</p>}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-mint/80">Total earned</p><p className="text-xl font-bold">+{w.total_earned}</p></div>
            <div className="rounded-2xl bg-white/10 p-3"><p className="text-xs text-mint/80">Total spent</p><p className="text-xl font-bold">−{w.total_spent}</p></div>
          </div>
        </div>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Can I request produce?</h2>
            <span className={`text-xs font-bold px-2.5 h-6 rounded-full inline-flex items-center ${el.eligible ? 'bg-mint text-forest' : 'bg-honey-soft text-earth'}`}>{el.eligible ? 'Yes' : 'Not right now'}</span>
          </div>
          <ul className="mt-4 space-y-3">
            {el.checks.map((c) => (
              <li key={c.key} className="flex gap-3">
                <span className={`size-6 rounded-full grid place-items-center shrink-0 ${c.ok ? 'bg-mint text-forest' : 'bg-honey-soft text-earth'}`}><Icon name={c.ok ? 'check' : 'info'} size={14} strokeWidth={2.5} /></span>
                <div><p className="text-sm font-semibold">{c.label}</p><p className="text-xs text-muted">{c.detail}</p></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="font-bold mb-2">How credits work</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc pl-5">
            <li>Share produce → <b className="text-ink">earn</b> credits when a neighbour collects it.</li>
            <li>Request produce → credits are <b className="text-ink">held</b>, then spent when the contributor accepts.</li>
            <li>Declined, cancelled by the contributor, or expired → you get a <b className="text-ink">full refund</b>.</li>
            <li>Leafy greens and herbs are worth more per kg than potatoes or onions. Every listing shows its rate.</li>
            {data.settings && <li>Missed pickups cost {data.settings.no_show_penalty} credits. Your balance can dip to {data.settings.min_balance} at most.</li>}
          </ul>
        </Card>

        {data.recent_contributions.length > 0 && (
          <Card className="p-5">
            <h2 className="font-bold mb-3">Your recent contributions</h2>
            <ul className="space-y-2.5">
              {data.recent_contributions.map((c, i) => (
                <li key={i} className="flex justify-between text-sm"><span>{formatQty(c.unit_type, c.quantity)} {c.produce_name}<span className="text-muted"> · {timeAgo(c.completed_at)}</span></span><span className="font-bold text-leaf">+{c.credits}</span></li>
              ))}
            </ul>
          </Card>
        )}

        <div>
          <h2 className="font-bold mb-3 px-1">Transaction history</h2>
          <Card className="divide-y divide-line/70">
            {data.transactions.length === 0 && <p className="p-4 text-sm text-muted">No transactions yet.</p>}
            {data.transactions.map((t) => {
              const meta = TX[t.type] ?? TX.adjustment;
              const row = (
                <div className="flex items-center gap-3 p-4">
                  <span className="size-9 rounded-xl bg-mint-soft text-forest grid place-items-center shrink-0"><Icon name={meta.icon} size={18} /></span>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{t.description}</p><p className="text-xs text-muted">{meta.label} · {timeAgo(t.created_at)}</p></div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold tabular-nums ${t.amount > 0 ? 'text-leaf' : t.amount < 0 ? 'text-earth' : 'text-muted'}`}>{t.amount > 0 ? '+' : ''}{t.amount === 0 ? '±0' : t.amount}</p>
                    <p className="text-[11px] text-muted tabular-nums">bal {t.balance_after}</p>
                  </div>
                </div>
              );
              return t.exchange_id ? <Link key={t.id} to={`/exchanges/${t.exchange_id}`} className="block hover:bg-mint-soft/50">{row}</Link> : <div key={t.id}>{row}</div>;
            })}
          </Card>
          <p className="text-xs text-muted mt-2 px-1">"Spent" entries show ±0 because those credits already left your available balance when they were held.</p>
        </div>
      </div>
    </div>
  );
}
