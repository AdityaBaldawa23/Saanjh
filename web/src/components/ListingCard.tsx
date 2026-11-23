import { Link } from 'react-router-dom';
import type { Listing } from '../types';
import { CONDITION, formatQty, timeAgo, timeLeft } from '../lib';
import { CreditPill, Icon, ProduceImage } from './ui';

export function ListingCard({ l, wide }: { l: Listing; wide?: boolean }) {
  const urgent = l.available_until - Date.now() < 12 * 3_600_000;
  return (
    <Link to={`/listing/${l.id}`} className={`block bg-white rounded-3xl shadow-card overflow-hidden active:scale-[.99] transition ${wide ? 'w-60 shrink-0' : ''}`}>
      <div className="relative">
        <ProduceImage src={l.photo_url} emoji={l.emoji} category={l.category} alt={l.name} className="w-full aspect-[4/3]" />
        <span className={`absolute top-2.5 left-2.5 h-6 px-2 rounded-full text-[11px] font-bold inline-flex items-center gap-1 backdrop-blur ${urgent ? 'bg-honey text-ink' : 'bg-white/90 text-ink'}`}>
          <Icon name="clock" size={13} strokeWidth={2.2} />{timeLeft(l.available_until)}
        </span>
        {l.condition === 'use_soon' && <span className="absolute top-2.5 right-2.5 h-6 px-2 rounded-full text-[11px] font-bold bg-white/90 text-earth inline-flex items-center">{CONDITION.use_soon.label}</span>}
        {l.is_mine && <span className="absolute bottom-2.5 left-2.5 h-6 px-2 rounded-full text-[11px] font-bold bg-forest text-white inline-flex items-center">Yours</span>}
      </div>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-[15px] leading-tight">{l.name}</h3>
          <CreditPill value={l.unit_type === 'weight' ? `${l.rate}/kg` : `${l.rate}/pc`} />
        </div>
        <p className="text-sm text-ink/80 mt-1 font-medium">{formatQty(l.unit_type, l.qty_available)} available</p>
        <p className="text-[11px] text-muted mt-0.5 truncate">Listed {timeAgo(l.created_at)}{l.pickup_note ? ` · ${l.pickup_note}` : ''}</p>
        <p className="text-xs text-muted mt-1.5 flex items-center gap-1 truncate"><Icon name="pin" size={13} />{l.contributor.first_name} · {l.contributor.location}</p>
      </div>
    </Link>
  );
}
