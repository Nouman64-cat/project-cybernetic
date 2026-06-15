'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/axios';
import { ResearchProject, ResearchStatus } from '@/types/research';
import Sidebar from './Sidebar';
import AgentStage from './AgentStage';
import ResearchHistory from './ResearchHistory';
import ReportModal from './ReportModal';

type View = 'chat' | 'history';
const ACTIVE: ResearchStatus[] = ['pending', 'in_progress'];
const POLL_MS = 4_000;

export default function AppShell() {
  const [view, setView] = useState<View>('chat');
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProject, setActiveProject] = useState<ResearchProject | null>(null);
  const [modal, setModal] = useState<{ projectId: string; title: string } | null>(null);
  const activeRef = useRef(activeProject);
  activeRef.current = activeProject;

  // Bootstrap: load all existing projects
  useEffect(() => {
    api.get<ResearchProject[]>('/api/research/').then(r => setProjects(r.data)).catch(() => {});
  }, []);

  // Poll the current active project until it's done
  useEffect(() => {
    if (!activeProject || !ACTIVE.includes(activeProject.status)) return;
    const id = setInterval(async () => {
      try {
        const { data } = await api.get<ResearchProject>(`/api/research/status/${activeProject.project_id}`);
        setActiveProject(data);
        setProjects(prev => prev.map(p => p.project_id === data.project_id ? data : p));
      } catch { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [activeProject?.project_id, activeProject?.status]);

  const handleSubmit = useCallback(async (query: string) => {
    const title = query.length > 72 ? query.slice(0, 70) + '…' : query;
    try {
      const { data } = await api.post('/api/research/start', { title, query });
      const project: ResearchProject = {
        project_id: data.project_id,
        title,
        status: data.status ?? 'pending',
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      setActiveProject(project);
      setProjects(prev => [project, ...prev]);
      setView('chat');
    } catch {
      // TODO: surface error to user
    }
  }, []);

  const handleAgentStageComplete = useCallback(() => {
    if (activeRef.current) {
      const updated = { ...activeRef.current, status: 'completed' as ResearchStatus };
      setActiveProject(updated);
      setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p));
    }
  }, []);

  function handleNewResearch() {
    setActiveProject(null);
    setView('chat');
  }

  const activeCount = projects.filter(p => ACTIVE.includes(p.status)).length;
  const isRunning = !!activeProject && ACTIVE.includes(activeProject.status);
  const isComplete = !!activeProject && activeProject.status === 'completed';
  const isFailed = !!activeProject && activeProject.status === 'failed';

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar view={view} onViewChange={setView} activeCount={activeCount} />

      {/* ── Right panel ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header */}
        <header className="shrink-0 flex items-center justify-between border-b border-gray-100 px-6 py-3 bg-white z-10">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">
              {view === 'history' ? 'Past Researches' : 'Research Chat'}
            </h1>
            <p className="text-[11px] text-gray-400">
              {view === 'history'
                ? `${projects.length} total · ${projects.filter(p => p.status === 'completed').length} completed`
                : isRunning
                ? 'Agents are working…'
                : isComplete
                ? 'Research complete'
                : 'Ask anything — agents will research it'
              }
            </p>
          </div>

          {activeCount > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs text-cyan-700 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
              {activeCount} running
            </div>
          )}
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-hidden relative">
          {view === 'history' ? (
            <div className="h-full overflow-y-auto">
              <ResearchHistory
                projects={projects}
                onViewReport={(id, title) => setModal({ projectId: id, title })}
              />
            </div>
          ) : (
            <ChatPane
              activeProject={activeProject}
              isRunning={isRunning}
              isComplete={isComplete}
              isFailed={isFailed}
              onSubmit={handleSubmit}
              onComplete={handleAgentStageComplete}
              onViewReport={() => activeProject && setModal({ projectId: activeProject.project_id, title: activeProject.title })}
              onNewResearch={handleNewResearch}
            />
          )}
        </main>
      </div>

      {modal && (
        <ReportModal
          projectId={modal.projectId}
          title={modal.title}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Chat pane ─────────────────────────────────────────────────────────────────

interface ChatPaneProps {
  activeProject: ResearchProject | null;
  isRunning: boolean;
  isComplete: boolean;
  isFailed: boolean;
  onSubmit: (query: string) => Promise<void>;
  onComplete: () => void;
  onViewReport: () => void;
  onNewResearch: () => void;
}

function ChatPane({ activeProject, isRunning, isComplete, isFailed, onSubmit, onComplete, onViewReport, onNewResearch }: ChatPaneProps) {

  if (!activeProject) {
    return <IdlePrompt onSubmit={onSubmit} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Research topic bar */}
      <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-6 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Research topic</p>
          <h2 className="text-sm font-semibold text-gray-800 truncate">{activeProject.title}</h2>
        </div>
        {isComplete && (
          <div className="flex items-center gap-2">
            <button
              onClick={onViewReport}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 transition active:scale-95"
            >
              Open Report
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
            </button>
            <button
              onClick={onNewResearch}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition"
            >
              New Research
            </button>
          </div>
        )}
        {isFailed && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500 font-medium">Pipeline failed</span>
            <button
              onClick={onNewResearch}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Agent stage — fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <AgentStage
          projectId={activeProject.project_id}
          onComplete={onComplete}
        />
      </div>
    </div>
  );
}

// ── Idle prompt ───────────────────────────────────────────────────────────────

function IdlePrompt({ onSubmit }: { onSubmit: (q: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSubmit() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    await onSubmit(q);
    setLoading(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const EXAMPLES = [
    'Impact of generative AI on the healthcare industry',
    'Latest advances in quantum computing hardware',
    'How does CRISPR gene editing work?',
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">

        {/* Logo + headline */}
        <div className="text-center mb-8">
          <HexLogo />
          <h2 className="mt-4 text-2xl font-bold text-gray-900 tracking-tight">
            What would you like to research?
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Type a topic or question — three AI agents will research, synthesise, and review it for you.
          </p>
        </div>

        {/* Input */}
        <div className={`relative rounded-2xl border bg-white shadow-sm transition-all duration-200
          ${loading ? 'border-cyan-300 shadow-cyan-100' : 'border-gray-200 focus-within:border-cyan-300 focus-within:shadow-cyan-100 focus-within:shadow-md'}
        `}>
          <textarea
            ref={inputRef}
            rows={3}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Impact of generative AI on the healthcare industry…"
            disabled={loading}
            className="w-full resize-none rounded-2xl px-5 pt-4 pb-14 text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none leading-relaxed"
          />
          <div className="absolute bottom-3 right-3 left-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 pl-1">
              {query.length > 0 ? `${query.length} chars · Press Enter to start` : 'Shift+Enter for new line'}
            </span>
            <button
              onClick={handleSubmit}
              disabled={!query.trim() || loading}
              className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-95"
            >
              {loading ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Starting…
                </>
              ) : (
                <>
                  Research
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Example prompts */}
        <div className="mt-5">
          <p className="text-[11px] text-gray-400 text-center mb-3 uppercase tracking-widest">Try an example</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setQuery(ex)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50 transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Agent info strip */}
        <div className="mt-8 flex items-center justify-center gap-6 border-t border-gray-100 pt-6">
          {[
            { emoji: '🔍', label: 'Researcher', desc: 'Searches the web' },
            { emoji: '✍️', label: 'Synthesizer', desc: 'Writes the report' },
            { emoji: '🧐', label: 'Critic', desc: 'Reviews quality' },
          ].map(({ emoji, label, desc }) => (
            <div key={label} className="flex flex-col items-center gap-1 text-center">
              <span className="text-2xl">{emoji}</span>
              <span className="text-xs font-semibold text-gray-700">{label}</span>
              <span className="text-[10px] text-gray-400">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HexLogo() {
  return (
    <div className="flex justify-center">
      <svg width="52" height="52" viewBox="0 0 28 28" fill="none">
        <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
        <circle cx="14" cy="14" r="3" fill="#06b6d4" />
        <line x1="14" y1="2" x2="14" y2="5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
        <line x1="14" y1="23" x2="14" y2="26" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
        <line x1="3" y1="8" x2="6" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
        <line x1="25" y1="8" x2="22" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      </svg>
    </div>
  );
}
