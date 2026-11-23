export type Category = 'fruit' | 'vegetable' | 'leafy';
export type UnitType = 'weight' | 'piece';
export type Condition = 'fresh' | 'good' | 'use_soon';
export type ExStatus = 'pending' | 'accepted' | 'completed' | 'rejected' | 'cancelled' | 'no_show' | 'expired';

export interface Membership {
  membership_id: number; user_id: number; society_id: number; society_name: string;
  building: string; wing: string; flat: string; status: 'pending' | 'approved' | 'rejected'; role: 'resident' | 'admin'; reject_reason: string | null;
}
export interface Wallet { user_id: number; balance: number; held: number; total_earned: number; total_spent: number }
export interface Me {
  user: { id: number; name: string; email: string | null; phone: string | null; avatar_url: string | null; restricted_until: number | null; created_at: number };
  membership: Membership | null;
  wallet: Wallet;
  stats: { shared: number; shared_grams: number; received: number; received_grams: number; strikes: number };
  unread_notifications: number;
  admin_todo: { pending_members: number; open_reports: number } | null;
}

export interface Listing {
  id: number; name: string; category: Category; emoji: string | null; unit_type: UnitType; display_unit: 'g' | 'kg' | 'pcs';
  qty_total: number; qty_available: number; min_request: number; rate: number; credits_per_unit: number;
  credits_for_all: number; credits_example: number; photo_url: string; purchase_date: string | null; condition: Condition;
  pickup_from: number; available_until: number; pickup_note: string; notes: string; status: string; created_at: number;
  is_mine: boolean; open_requests?: number;
  contributor: { first_name: string; avatar_url: string | null; location: string; shares: number };
  my_request?: { id: number; status: ExStatus; quantity: number; credits: number } | null;
  reported_by_me?: boolean;
  requests?: { id: number; quantity: number; credits: number; status: ExStatus; message: string; created_at: number; requester_name: string; location: string; flat?: string }[];
}

export interface Exchange {
  id: number; listing_id: number; role: 'giver' | 'receiver'; status: ExStatus; quantity: number; credits: number;
  quantity_label: string; message: string; owner_note: string; cancelled_by: string | null; close_reason: string | null;
  owner_confirmed: boolean; requester_confirmed: boolean; owner_confirmed_at: number | null; requester_confirmed_at: number | null; created_at: number; accepted_at: number | null; closed_at: number | null;
  produce: { name: string; photo_url: string; emoji: string | null; category: Category; unit_type: UnitType; pickup_from: number; available_until: number; pickup_note: string; status: string };
  counterparty: { name: string; location: string; flat: string | null };
}

export interface Check { key: string; ok: boolean; label: string; detail: string }
export interface Eligibility {
  eligible: boolean; checks: Check[];
  limits: { balance: number; held: number; min_balance: number; max_spend: number; weekly_used: number; weekly_cap: number } | null;
}
export interface Txn { id: number; type: string; amount: number; balance_after: number; description: string; exchange_id: number | null; created_at: number }
export interface Notification { id: number; type: string; title: string; body: string; link: string | null; read: boolean; created_at: number }
