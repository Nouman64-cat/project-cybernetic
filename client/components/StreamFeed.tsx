'use client';

import { useEffect, useRef, useState } from 'react';
import { StreamEvent, StreamEventType } from '@/types/research';

interface Props {
  projectId: string;
  active: boolean;
}

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:7005';

// Visual config per event type
const EVENT_STYLE: Record<
  StreamEventType,
  { icon: string; labelColor: string; borderColor: string; bold?: boolean }
> = {
  phase:     { icon: '◈', labelColor: 'text-cyan-600',   borderColor: 'border-cyan-400', bold: true },
  search:    { icon: '⌕', labelColor: 'text-blue-500',   borderColor: 'border-blue-300' },
  extract:   { icon: '↓', labelColor: 'text-gray-400',   borderColor: 'border-gray-300' },
  phase_end: { icon: '✓', labelColor: 'text-cyan-600',   borderColor: 'border-cyan-300' },
  writing:   { icon: '✎', labelColor: 'text-violet-500', borderColor: 'border-violet-300' },
  review:    { icon: '◉', labelColor: 'text-amber-500',  borderColor: 'border-amber-300' },
  revision:  { icon: '⚑', labelColor: 'text-orange-500', borderColor: 'border-orange-300' },
  approved:  { icon: '✓', labelColor: 'text-emerald-600',borderColor: 'border-emerald-400' },
  complete:  { icon: '★', labelColor: 'text-emerald-600',borderColor: 'border-emerald-400', bold: true },
  error:     { icon: '✕', labelColor: 'text-red-500',    borderColor: 'border-red-300' },
};

function EventRow({ event }: { event: StreamEvent }) {
  const style = EVENT_STYLE[event.type] ?? EVENT_STYLE.search;
  return (
    <div
      className={`flex items-start gap-2 border-l-2 pl-2 py-0.5 ${style.borderColor} animate-fade-in`}
    >
      <span className={`shrink-0 w-3 text-center text-xs leading-4 ${style.labelColor}`}>
        {style.icon}
      </span>
      <span
        className={`text-xs leading-4 ${style.labelColor} ${style.bold ? 'font-semibold' : 'font-normal'}`}
      >
        {event.content}
      </span>
    </div>
  );
}

export default function StreamFeed({ projectId, active }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active) return;

    const es = new EventSource(`${SERVER}/api/research/stream/${projectId}`);
    sourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const ev: StreamEvent = JSON.parse(e.data);
        setEvents((prev) => {
          // Keep only the last 60 events to avoid unbounded growth
          const next = [...prev, ev];
          return next.length > 60 ? next.slice(-60) : next;
        });
        if (ev.type === 'complete' || ev.type === 'error') {
          es.close();
          sourceRef.current = null;
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      es.close();
      sourceRef.current = null;
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [projectId, active]);

  // Auto-scroll to bottom whenever events change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      {/* Sticky header */}
      <div className="flex items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
        <span className="text-xs font-medium text-gray-500 tracking-wide uppercase">
          Live Agent Feed
        </span>
      </div>

      {/* Scrollable event log */}
      <div className="max-h-44 overflow-y-auto px-3 py-2 space-y-1 font-mono">
        {events.map((ev, i) => (
          <EventRow key={i} event={ev} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
