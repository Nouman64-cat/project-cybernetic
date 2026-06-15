'use client';

import { useEffect, useRef, useState } from 'react';
import { StreamEvent } from '@/types/research';
import { renderMarkdownInline } from '@/lib/markdown';

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:7005';

type AgentKey = 'ResearcherAgent' | 'SynthesizerAgent' | 'CriticAgent';
type AgentStatus = 'idle' | 'active' | 'done';

interface AgentState {
  status: AgentStatus;
  bubble: string;
}

const AGENT_META: Record<AgentKey, {
  label: string;
  short: string;
  emoji: string;
  bg: string;
  ring: string;
  glow: string;
  bubbleBg: string;
  bubbleBorder: string;
  labelColor: string;
}> = {
  ResearcherAgent: {
    label: 'Researcher',
    short: 'R',
    emoji: '🔍',
    bg: 'bg-blue-500',
    ring: 'ring-blue-300',
    glow: 'shadow-blue-300',
    bubbleBg: 'bg-blue-50',
    bubbleBorder: 'border-blue-200',
    labelColor: 'text-blue-600',
  },
  SynthesizerAgent: {
    label: 'Synthesizer',
    short: 'S',
    emoji: '✍️',
    bg: 'bg-violet-500',
    ring: 'ring-violet-300',
    glow: 'shadow-violet-300',
    bubbleBg: 'bg-violet-50',
    bubbleBorder: 'border-violet-200',
    labelColor: 'text-violet-600',
  },
  CriticAgent: {
    label: 'Critic',
    short: 'C',
    emoji: '🧐',
    bg: 'bg-amber-500',
    ring: 'ring-amber-300',
    glow: 'shadow-amber-300',
    bubbleBg: 'bg-amber-50',
    bubbleBorder: 'border-amber-200',
    labelColor: 'text-amber-700',
  },
};

const INITIAL_STATES: Record<AgentKey, AgentState> = {
  ResearcherAgent: { status: 'idle', bubble: '' },
  SynthesizerAgent: { status: 'idle', bubble: '' },
  CriticAgent: { status: 'idle', bubble: '' },
};

interface Props {
  projectId: string;
  onComplete?: () => void;
}

export default function AgentStage({ projectId, onComplete }: Props) {
  const [agents, setAgents] = useState<Record<AgentKey, AgentState>>(INITIAL_STATES);
  const [phase, setPhase] = useState<1 | 2>(1);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function setAgent(key: AgentKey, patch: Partial<AgentState>) {
    setAgents((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function truncate(s: string, n = 70) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  useEffect(() => {
    const es = new EventSource(`${SERVER}/api/research/stream/${projectId}`);

    es.onmessage = (e) => {
      try {
        const ev: StreamEvent = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, ev];
          return next.length > 150 ? next.slice(-150) : next;
        });

        const { type, content } = ev;

        if (type === 'phase') {
          if (content.toLowerCase().includes('1')) {
            setPhase(1);
            setAgent('ResearcherAgent', { status: 'active', bubble: 'Starting research…' });
          } else if (content.toLowerCase().includes('2')) {
            setPhase(2);
            setAgent('ResearcherAgent', { status: 'done', bubble: 'Findings compiled ✓' });
            setAgent('SynthesizerAgent', { status: 'active', bubble: 'Writing report…' });
          }
        } else if (type === 'search') {
          setAgent('ResearcherAgent', { status: 'active', bubble: 'Searching: ' + truncate(content, 55) });
        } else if (type === 'extract') {
          setAgent('ResearcherAgent', { status: 'active', bubble: 'Reading: ' + truncate(content, 57) });
        } else if (type === 'phase_end') {
          setAgent('ResearcherAgent', { status: 'done', bubble: content || 'Research compiled ✓' });
        } else if (type === 'draft_preview') {
          setAgent('SynthesizerAgent', { status: 'active', bubble: truncate(content, 70) });
          setAgent('CriticAgent', { status: 'idle', bubble: '' });
        } else if (type === 'critic_feedback') {
          setAgent('CriticAgent', { status: 'active', bubble: truncate(content.split('\n')[0] ?? content, 65) });
          setAgent('SynthesizerAgent', { status: 'idle', bubble: 'Revising…' });
        } else if (type === 'approved') {
          setAgent('CriticAgent', { status: 'done', bubble: 'Approved ✓' });
          setAgent('SynthesizerAgent', { status: 'done', bubble: 'Report complete ✓' });
        } else if (type === 'complete') {
          setAgent('ResearcherAgent', { status: 'done', bubble: '' });
          setAgent('SynthesizerAgent', { status: 'done', bubble: '' });
          setAgent('CriticAgent', { status: 'done', bubble: '' });
          setDone(true);
          es.close();
          onComplete?.();
        } else if (type === 'error') {
          es.close();
        }
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [projectId, onComplete]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  let draftCount = -1;

  return (
    <div className="flex flex-col h-full">

      {/* ── Agent cartoon stage ─────────────────────────────────────────── */}
      <div className="flex items-start justify-center gap-6 py-8 px-4">

        {/* Agents with connectors */}
        <div className="contents">
          <AgentCard agentId="ResearcherAgent" state={agents.ResearcherAgent} />

          {/* R → S handoff arrow */}
          <div className={`flex flex-col items-center justify-center pt-8 gap-1 transition-opacity duration-500 ${phase === 2 ? 'opacity-80' : 'opacity-20'}`}>
            <div className="h-px w-10 bg-gray-300" />
            <span className="text-[11px] text-gray-400">→</span>
          </div>

          <AgentCard agentId="SynthesizerAgent" state={agents.SynthesizerAgent} />

          {/* S ⇄ C back-and-forth connector */}
          <div className={`flex flex-col items-center justify-center pt-8 gap-1 transition-opacity duration-500 ${phase === 2 ? 'opacity-100' : 'opacity-0'}`}>
            <div className="h-px w-10 bg-gray-300" />
            <span className="text-gray-400 text-sm">⇄</span>
            <div className="h-px w-10 bg-gray-300" />
          </div>

          <AgentCard agentId="CriticAgent" state={agents.CriticAgent} />
        </div>
      </div>

      {/* ── Event log ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto border-t border-gray-100 bg-gray-50/60">
        <div className="px-4 py-3 space-y-1.5">
          {events.map((ev, i) => <EventRow key={i} ev={ev} draftIdx={countDrafts(events, i)} />)}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Done banner */}
      {done && (
        <div className="shrink-0 flex items-center justify-center gap-3 border-t border-emerald-200 bg-gradient-to-r from-emerald-50 via-cyan-50 to-emerald-50 py-3">
          <span className="text-emerald-500 text-xl">✓</span>
          <span className="text-sm font-semibold text-emerald-700">Research complete — report ready</span>
        </div>
      )}
    </div>
  );
}

// ── Helper: count draft_preview events up to index i ────────────────────────
function countDrafts(events: StreamEvent[], upTo: number) {
  let n = -1;
  for (let i = 0; i <= upTo; i++) {
    if (events[i]?.type === 'draft_preview') n++;
  }
  return n;
}

// ── Agent card with avatar + bubble ─────────────────────────────────────────
function AgentCard({ agentId, state }: { agentId: AgentKey; state: AgentState }) {
  const m = AGENT_META[agentId];
  const { status, bubble } = state;

  return (
    <div className="flex flex-col items-center gap-3 w-40">

      {/* Avatar */}
      <div className="relative flex items-center justify-center">
        {/* Ping ring when active */}
        {status === 'active' && (
          <div className={`absolute inset-0 rounded-full ${m.bg} opacity-25 scale-125 animate-ping`} />
        )}
        {/* Static glow ring when active */}
        {status === 'active' && (
          <div className={`absolute inset-0 rounded-full ${m.bg} opacity-15 scale-150`} />
        )}

        <div
          className={`relative h-20 w-20 rounded-full ${m.bg} flex flex-col items-center justify-center text-white font-bold shadow-lg transition-all duration-300
            ${status === 'active' ? `ring-4 ${m.ring} ring-offset-2 shadow-xl ${m.glow} scale-110` : ''}
            ${status === 'done' ? 'opacity-60 scale-95' : ''}
            ${status === 'idle' ? 'opacity-40 scale-95' : ''}
          `}
        >
          <span className="text-2xl">{m.emoji}</span>
          <span className="text-[11px] font-semibold opacity-80 mt-0.5">{m.short}</span>

          {/* Done checkmark badge */}
          {status === 'done' && (
            <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center ring-2 ring-white">
              <span className="text-white text-[10px] font-bold">✓</span>
            </div>
          )}

          {/* Active ping dot */}
          {status === 'active' && (
            <div className="absolute top-1 right-1 h-3 w-3 rounded-full bg-white/80 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
            </div>
          )}
        </div>
      </div>

      {/* Name + status */}
      <div className="text-center">
        <p className={`text-sm font-semibold transition-colors ${
          status === 'active' ? m.labelColor : 'text-gray-500'
        }`}>
          {m.label}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {status === 'active' ? '● Working' : status === 'done' ? '● Done' : '● Waiting'}
        </p>
      </div>

      {/* Speech bubble */}
      <SpeechBubble text={bubble} agentId={agentId} visible={!!bubble && status !== 'idle'} />
    </div>
  );
}

function SpeechBubble({ text, agentId, visible }: { text: string; agentId: AgentKey; visible: boolean }) {
  const m = AGENT_META[agentId];
  if (!visible || !text) return <div className="h-14" />;

  return (
    <div className="relative w-full">
      {/* Pointer */}
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-2.5 rotate-45 ${m.bubbleBg} border-t border-l ${m.bubbleBorder}`}
      />
      <div className={`${m.bubbleBg} border ${m.bubbleBorder} rounded-xl p-2.5 text-center`}>
        <p className="text-[11px] text-gray-700 leading-snug line-clamp-3">{text}</p>
      </div>
    </div>
  );
}

// ── Event row renderer ────────────────────────────────────────────────────────
function EventRow({ ev, draftIdx }: { ev: StreamEvent; draftIdx: number }) {
  const { type, content } = ev;

  if (type === 'phase') {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[9px] font-semibold tracking-widest text-gray-400 uppercase px-1">{content}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
    );
  }
  if (type === 'search') {
    return (
      <div className="flex items-center gap-2 pl-4">
        <span className="text-[11px] text-blue-400 font-mono">⌕</span>
        <span className="text-[11px] text-gray-500 truncate">Searching: {content}</span>
      </div>
    );
  }
  if (type === 'extract') {
    return (
      <div className="flex items-center gap-2 pl-4">
        <span className="text-[11px] text-blue-300 font-mono">↓</span>
        <span className="text-[11px] text-gray-400 truncate">Reading: {content}</span>
      </div>
    );
  }
  if (type === 'phase_end') {
    return (
      <div className="flex items-center gap-1.5 pl-4">
        <span className="text-[11px] text-cyan-500">✓</span>
        <span className="text-[11px] text-cyan-600 font-medium">{content}</span>
      </div>
    );
  }
  if (type === 'draft_preview') {
    const lastDot = content.lastIndexOf(' · ');
    const preview = lastDot > 0 ? content.slice(0, lastDot) : content;
    const wc = lastDot > 0 ? content.slice(lastDot + 3) : '';
    return (
      <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
        <div className="h-4 w-4 rounded-full bg-violet-500 flex items-center justify-center text-white text-[8px] font-bold shrink-0 mt-0.5">S</div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-violet-600 uppercase tracking-wide">
            Draft {draftIdx > 0 ? `Rev. ${draftIdx}` : '1'}
            {wc && <span className="ml-2 normal-case font-normal text-violet-400">{wc}</span>}
          </span>
          <div
            className="text-[11px] text-gray-600 leading-relaxed mt-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdownInline(preview) }}
          />
        </div>
      </div>
    );
  }
  if (type === 'critic_feedback') {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        <div className="h-4 w-4 rounded-full bg-amber-500 flex items-center justify-center text-white text-[8px] font-bold shrink-0 mt-0.5">C</div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Revision requested</span>
          <div
            className="text-[11px] text-gray-700 leading-relaxed mt-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdownInline(content) }}
          />
        </div>
      </div>
    );
  }
  if (type === 'approved') {
    return (
      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <span className="text-emerald-500 text-sm">✓</span>
        <span className="text-[11px] text-emerald-700 font-medium">{content}</span>
      </div>
    );
  }
  if (type === 'complete') {
    return (
      <div className="flex items-center gap-2 bg-gradient-to-r from-cyan-50 to-emerald-50 border border-cyan-200 rounded-lg px-3 py-2">
        <span className="text-cyan-500 text-sm">★</span>
        <span className="text-[11px] text-cyan-700 font-semibold">Research complete</span>
      </div>
    );
  }
  if (type === 'error') {
    return (
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <span className="text-red-400 text-xs">✕</span>
        <span className="text-[11px] text-red-600">{content}</span>
      </div>
    );
  }
  return null;
}
