'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/axios';
import { ResearchProject, ResearchStatus } from '@/types/research';
import NewResearchForm from './NewResearchForm';
import ProjectCard from './ProjectCard';
import ReportModal from './ReportModal';

const POLL_INTERVAL_MS = 5_000;
const ACTIVE: ResearchStatus[] = ['pending', 'in_progress'];

export default function Dashboard() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [modal, setModal] = useState<{ projectId: string; title: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const activeProjectsRef = useRef<ResearchProject[]>([]);

  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await api.get<ResearchProject[]>('/api/research/');
      setProjects(data);
    } catch {
      // silently ignore
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const pollActiveProjects = useCallback(async () => {
    const active = activeProjectsRef.current;
    if (active.length === 0) return;

    const updates = await Promise.allSettled(
      active.map((p) =>
        api.get<ResearchProject>(`/api/research/status/${p.project_id}`).then((r) => r.data),
      ),
    );

    setProjects((prev) => {
      const map = new Map(prev.map((p) => [p.project_id, p]));
      updates.forEach((result) => {
        if (result.status === 'fulfilled') map.set(result.value.project_id, result.value);
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    });
  }, []);

  useEffect(() => {
    activeProjectsRef.current = projects.filter((p) => ACTIVE.includes(p.status));
  }, [projects]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    const id = setInterval(pollActiveProjects, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollActiveProjects]);

  function handleSubmitted(project: ResearchProject) {
    setProjects((prev) => [project, ...prev]);
    setShowForm(false);
  }

  const activeCount = projects.filter((p) => ACTIVE.includes(p.status)).length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const failedCount = projects.filter((p) => p.status === 'failed').length;

  return (
    <>
      <div className="min-h-screen bg-[#f5f6fa]">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <HexLogo />
              <div className="flex flex-col leading-none">
                <span className="text-sm font-bold tracking-tight text-gray-900">Cybernetic</span>
                <span className="text-[10px] text-gray-400 tracking-widest uppercase">Deep Research</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activeCount > 0 && (
                <div className="flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs text-cyan-700 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
                  {activeCount} running
                </div>
              )}
              <button
                onClick={() => setShowForm((v) => !v)}
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 transition active:scale-95"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                New Research
              </button>
            </div>
          </div>
        </header>

        {/* ── Stats bar ───────────────────────────────────────────────────── */}
        {projects.length > 0 && (
          <div className="bg-white border-b border-gray-100">
            <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-6">
              <StatChip label="Total" value={projects.length} />
              <div className="h-4 w-px bg-gray-200" />
              <StatChip label="Active" value={activeCount} color="text-cyan-600" />
              <StatChip label="Completed" value={completedCount} color="text-emerald-600" />
              {failedCount > 0 && <StatChip label="Failed" value={failedCount} color="text-red-500" />}
            </div>
          </div>
        )}

        <main className="mx-auto max-w-7xl px-6 py-8">

          {/* ── New Research Slide-in ─────────────────────────────────────── */}
          {showForm && (
            <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">New Research</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Three agents will search, synthesise, and critically review your topic.
                  </p>
                </div>
                <button
                  onClick={() => setShowForm(false)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
              <NewResearchForm onSubmitted={handleSubmitted} />
            </div>
          )}

          {/* ── Agent legend ──────────────────────────────────────────────── */}
          {activeCount > 0 && (
            <div className="mb-4 flex items-center gap-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Agents</span>
              {[
                { short: 'R', label: 'Researcher', bg: 'bg-blue-500' },
                { short: 'S', label: 'Synthesizer', bg: 'bg-violet-500' },
                { short: 'C', label: 'Critic', bg: 'bg-amber-500' },
              ].map(({ short, label, bg }) => (
                <div key={short} className="flex items-center gap-1.5">
                  <div className={`h-4 w-4 rounded-full ${bg} flex items-center justify-center text-[8px] font-bold text-white`}>
                    {short}
                  </div>
                  <span className="text-[11px] text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Project grid ─────────────────────────────────────────────── */}
          {loadingProjects ? (
            <div className="flex items-center justify-center gap-2 py-24 text-gray-400 text-sm">
              <svg className="h-5 w-5 animate-spin text-cyan-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Loading…
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onNew={() => setShowForm(true)} />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
              {projects.map((p) => (
                <ProjectCard
                  key={p.project_id}
                  project={p}
                  onViewReport={(id, title) => setModal({ projectId: id, title })}
                />
              ))}
            </div>
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
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HexLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
      <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="3" fill="#06b6d4" />
      <line x1="14" y1="2" x2="14" y2="5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="14" y1="23" x2="14" y2="26" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="3" y1="8" x2="6" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="25" y1="8" x2="22" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="3" y1="20" x2="6" y2="18.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="25" y1="20" x2="22" y2="18.5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function StatChip({ label, value, color = 'text-gray-700' }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-base font-bold ${color}`}>{value}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-white py-24 text-center">
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
        <svg className="h-8 w-8 text-gray-300 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-600">No research yet</p>
        <p className="text-xs text-gray-400 mt-1">Start a question and watch the agents work</p>
      </div>
      <button
        onClick={onNew}
        className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-gray-700 transition"
      >
        Start first research
      </button>
    </div>
  );
}
