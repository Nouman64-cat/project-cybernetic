'use client';

import { useEffect, useRef, useState } from 'react';
import { StreamEvent } from '@/types/research';

interface Props {
  projectId: string;
  active: boolean;
}

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:7005';

// ── Agent identity config ────────────────────────────────────────────────────

type AgentKey = 'ResearcherAgent' | 'SynthesizerAgent' | 'CriticAgent' | 'system';

const AGENT: Record<AgentKey, {
  label: string;
  short: string;
  ring: string;          // avatar ring color (Tailwind literal)
  avatarBg: string;
  bubbleBg: string;
  bubbleBorder: string;
  labelColor: string;
  dotColor: string;
}> = {
  ResearcherAgent: {
    label: 'Researcher',
    short: 'R',
    ring: 'ring-blue-400',
    avatarBg: 'bg-blue-500',
    bubbleBg: 'bg-blue-50',
    bubbleBorder: 'border-blue-200',
    labelColor: 'text-blue-600',
    dotColor: 'bg-blue-400',
  },
  SynthesizerAgent: {
    label: 'Synthesizer',
    short: 'S',
    ring: 'ring-violet-400',
    avatarBg: 'bg-violet-500',
    bubbleBg: 'bg-violet-50',
    bubbleBorder: 'border-violet-200',
    labelColor: 'text-violet-600',
    dotColor: 'bg-violet-400',
  },
  CriticAgent: {
    label: 'Critic',
    short: 'C',
    ring: 'ring-amber-400',
    avatarBg: 'bg-amber-500',
    bubbleBg: 'bg-amber-50',
    bubbleBorder: 'border-amber-200',
    labelColor: 'text-amber-700',
    dotColor: 'bg-amber-400',
  },
  system: {
    label: 'System',
    short: '·',
    ring: 'ring-gray-300',
    avatarBg: 'bg-gray-300',
    bubbleBg: 'bg-gray-50',
    bubbleBorder: 'border-gray-200',
    labelColor: 'text-gray-500',
    dotColor: 'bg-gray-400',
  },
};

function agentKey(agent: string): AgentKey {
  if (agent === 'ResearcherAgent' || agent === 'SynthesizerAgent' || agent === 'CriticAgent') {
    return agent;
  }
  return 'system';
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ agentId, size = 'md' }: { agentId: AgentKey; size?: 'sm' | 'md' }) {
  const a = AGENT[agentId];
  const dim = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs';
  return (
    <div className={`shrink-0 ${dim} rounded-full ${a.avatarBg} flex items-center justify-center font-bold text-white ring-2 ${a.ring}`}>
      {a.short}
    </div>
  );
}

// ── Agent status header ──────────────────────────────────────────────────────

function AgentStatusRow({ activeAgent }: { activeAgent: AgentKey | null }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 bg-white/60">
      {(['ResearcherAgent', 'SynthesizerAgent', 'CriticAgent'] as AgentKey[]).map((id) => {
        const a = AGENT[id];
        const isActive = activeAgent === id;
        return (
          <div key={id} className="flex items-center gap-1.5">
            <div className={`h-5 w-5 rounded-full ${a.avatarBg} flex items-center justify-center text-[9px] font-bold text-white transition-all ${isActive ? 'ring-2 ' + a.ring + ' scale-110' : 'opacity-40'}`}>
              {a.short}
            </div>
            <span className={`text-[10px] font-medium transition-colors ${isActive ? a.labelColor : 'text-gray-300'}`}>
              {a.label}
            </span>
            {isActive && (
              <span className={`h-1.5 w-1.5 rounded-full ${a.dotColor} animate-pulse`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Event renderers ──────────────────────────────────────────────────────────

function PhaseDivider({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[10px] font-semibold tracking-widest text-gray-400 uppercase px-1">
        {content}
      </span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

function ToolRow({ icon, content, color }: { icon: string; content: string; color: string }) {
  return (
    <div className="flex items-start gap-2 pl-9 animate-fade-in">
      <span className={`shrink-0 w-3.5 text-[11px] leading-4 ${color}`}>{icon}</span>
      <span className="text-[11px] leading-4 text-gray-500 truncate max-w-[85%]">{content}</span>
    </div>
  );
}

function PhaseEndRow({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-2 pl-9 animate-fade-in">
      <span className="text-[11px] text-cyan-600 font-medium">✓ {content}</span>
    </div>
  );
}

function DraftBubble({ event, index }: { event: StreamEvent; index: number }) {
  // Content format: "preview text… · 1,241 words"
  const lastDot = event.content.lastIndexOf(' · ');
  const previewText = lastDot > 0 ? event.content.slice(0, lastDot) : event.content;
  const wordCount = lastDot > 0 ? event.content.slice(lastDot + 3) : '';
  const a = AGENT.SynthesizerAgent;

  return (
    <div className={`flex items-start gap-2 animate-fade-in`}>
      <Avatar agentId="SynthesizerAgent" />
      <div className={`flex-1 rounded-xl ${a.bubbleBg} border ${a.bubbleBorder} px-3 py-2.5`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${a.labelColor}`}>
            Synthesizer · Draft {index > 0 ? `Rev. ${index}` : ''}
          </span>
          {wordCount && (
            <span className="text-[10px] bg-violet-100 text-violet-600 rounded-full px-2 py-0.5 font-medium">
              {wordCount}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-700 leading-relaxed italic">&ldquo;{previewText}&rdquo;</p>
      </div>
    </div>
  );
}

function CriticBubble({ event }: { event: StreamEvent }) {
  const a = AGENT.CriticAgent;
  const lines = event.content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <Avatar agentId="CriticAgent" />
      <div className={`flex-1 rounded-xl ${a.bubbleBg} border ${a.bubbleBorder} px-3 py-2.5`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${a.labelColor}`}>
            Critic · Revision Requested
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        </div>
        <ul className="space-y-0.5">
          {lines.map((line, i) => (
            <li key={i} className="text-xs text-gray-700 leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ApprovedBanner({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 animate-fade-in">
      <span className="text-emerald-500 text-sm">✓</span>
      <span className="text-xs text-emerald-700 font-medium">{content}</span>
    </div>
  );
}

function CompleteBanner() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-50 to-emerald-50 border border-cyan-200 px-3 py-2 animate-fade-in">
      <span className="text-cyan-500 text-sm">★</span>
      <span className="text-xs text-cyan-700 font-semibold">Research complete</span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AgentConversation({ projectId, active }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
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
          const next = [...prev, ev];
          return next.length > 120 ? next.slice(-120) : next;
        });
        setActiveAgent(agentKey(ev.agent));
        if (ev.type === 'complete' || ev.type === 'error') {
          setActiveAgent(null);
          es.close();
          sourceRef.current = null;
        }
      } catch {
        // ignore malformed
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  if (events.length === 0) return null;

  // Track how many Synthesizer drafts we've seen (for "Rev. N" labels)
  let draftCount = -1;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-1.5">
          {activeAgent && (
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Agent Conversation
          </span>
        </div>
        <AgentStatusRow activeAgent={activeAgent} />
      </div>

      {/* Message feed */}
      <div className="max-h-80 overflow-y-auto px-3 py-3 space-y-2">
        {events.map((ev, i) => {
          const type = ev.type;

          if (type === 'phase') {
            return <PhaseDivider key={i} content={ev.content} />;
          }

          if (type === 'search') {
            return <ToolRow key={i} icon="⌕" content={ev.content} color="text-blue-400" />;
          }

          if (type === 'extract') {
            return <ToolRow key={i} icon="↓" content={ev.content} color="text-blue-300" />;
          }

          if (type === 'phase_end') {
            return <PhaseEndRow key={i} content={ev.content} />;
          }

          if (type === 'draft_preview') {
            draftCount++;
            return <DraftBubble key={i} event={ev} index={draftCount} />;
          }

          // legacy 'writing' events from old streams
          if (type === 'writing') {
            draftCount++;
            return (
              <div key={i} className="flex items-center gap-2 pl-9 animate-fade-in">
                <span className="text-[11px] text-violet-400">✎</span>
                <span className="text-[11px] text-gray-400">{ev.content}</span>
              </div>
            );
          }

          if (type === 'critic_feedback') {
            return <CriticBubble key={i} event={ev} />;
          }

          // legacy 'revision' events from old streams
          if (type === 'revision') {
            return (
              <div key={i} className="flex items-center gap-2 pl-9 animate-fade-in">
                <span className="text-[11px] text-amber-500">⚑</span>
                <span className="text-[11px] text-gray-500 truncate max-w-[85%]">{ev.content}</span>
              </div>
            );
          }

          if (type === 'approved') {
            return <ApprovedBanner key={i} content={ev.content} />;
          }

          if (type === 'complete') {
            return <CompleteBanner key={i} />;
          }

          if (type === 'error') {
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 animate-fade-in">
                <span className="text-red-400 text-xs">✕</span>
                <span className="text-xs text-red-600">{ev.content}</span>
              </div>
            );
          }

          return null;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
