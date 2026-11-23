import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { timeAgo, useQuery } from '../lib';
import type { Notification } from '../types';
import { Empty, ErrorState, Spinner, TopBar } from '../components/ui';

export default function Notifications() {
  const { data, loading, error, reload } = useQuery<Notification[]>('/notifications');
  const { refresh } = useSession();
  const nav = useNavigate();
  // Opening the list marks everything as read
  useEffect(() => { if (data?.some((n) => !n.read)) api.post('/notifications/read').then(refresh).catch(() => {}); }, [data, refresh]);

  return (
    <div>
      <TopBar title="Notifications" />
      {loading ? <Spinner /> : error ? <ErrorState message={error.message} retry={reload} /> : !data!.length ? (
        <Empty icon="bell" title="You're all caught up" body="Requests, pickups and credit updates will show up here." />
      ) : (
        <ul className="px-3 py-3">
          {data!.map((n) => (
            <li key={n.id}>
              <button disabled={!n.link} onClick={() => n.link && nav(n.link)} className={`w-full text-left flex gap-3 p-3 rounded-2xl ${n.link ? 'hover:bg-white' : ''}`}>
                <span className={`mt-1.5 size-2.5 rounded-full shrink-0 ${n.read ? 'bg-transparent' : 'bg-honey'}`} />
                <span className="flex-1">
                  <span className="block font-semibold text-[15px]">{n.title}</span>
                  <span className="block text-sm text-muted mt-0.5">{n.body}</span>
                  <span className="block text-xs text-muted mt-1">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
