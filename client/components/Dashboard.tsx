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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the full project list from the backend
  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await api.get<ResearchProject[]>('/api/research/');
      setProjects(data);
    } catch {
      // Silently ignore — shows stale data rather than crashing
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // Poll individual active project statuses and merge updates into state
  const pollActiveProjects = useCallback(async (active: ResearchProject[]) => {
    const updates = await Promise.allSettled(
      active.map((p) =>
        api
          .get<ResearchProject>(`/api/research/status/${p.project_id}`)
          .then((r) => r.data),
      ),
    );

    setProjects((prev) => {
      const map = new Map(prev.map((p) => [p.project_id, p]));
      updates.forEach((result) => {
        if (result.status === 'fulfilled') {
          map.set(result.value.project_id, result.value);
        }
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    });
  }, []);

  // On mount: load existing projects
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Polling: start when any project is active, stop when all are settled
  useEffect(() => {
    const active = projects.filter((p) => ACTIVE.includes(p.status));

    if (active.length > 0) {
      // Poll immediately, then on interval
      pollActiveProjects(active);
      intervalRef.current = setInterval(() => pollActiveProjects(active), POLL_INTERVAL_MS);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projects, pollActiveProjects]);

  function handleSubmitted(project: ResearchProject) {
    // Optimistically prepend the new project before the server confirms
    setProjects((prev) => [project, ...prev]);
  }

  const activeCount = projects.filter((p) => ACTIVE.includes(p.status)).length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;

  return (
    <>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <HexLogo />
              <div>
                <span className="text-base font-bold tracking-tight text-white">SynapseGrip</span>
                <span className="ml-2 text-xs text-zinc-500">Deep Research Intelligence</span>
              </div>
            </div>
            {/* Live indicator */}
            {activeCount > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                {activeCount} job{activeCount !== 1 ? 's' : ''} running
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10 lg:grid lg:grid-cols-[380px_1fr] lg:gap-10 lg:items-start">
          {/* ── Left: form ──────────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="mb-1 text-sm font-semibold text-zinc-100">New Research</h2>
              <p className="mb-5 text-xs text-zinc-500">
                Agents will search the web, extract sources, and synthesise a structured report.
              </p>
              <NewResearchForm onSubmitted={handleSubmitted} />
            </div>

            {/* Stats */}
            {projects.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label="Total" value={projects.length} />
                <Stat label="Active" value={activeCount} accent="cyan" />
                <Stat label="Done" value={completedCount} accent="emerald" />
              </div>
            )}
          </aside>

          {/* ── Right: project list ──────────────────────────────────────── */}
          <section>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">
                Research Jobs
                {projects.length > 0 && (
                  <span className="ml-2 text-zinc-500 font-normal">({projects.length})</span>
                )}
              </h2>
            </div>

            {loadingProjects ? (
              <div className="flex items-center justify-center gap-2 py-20 text-zinc-500 text-sm">
                <svg className="h-5 w-5 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Loading projects…
              </div>
            ) : projects.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="flex flex-col gap-3">
                {projects.map((p) => (
                  <li key={p.project_id}>
                    <ProjectCard
                      project={p}
                      onViewReport={(id, title) => setModal({ projectId: id, title })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      {/* ── Report Modal ─────────────────────────────────────────────────── */}
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

// ── Small sub-components ────────────────────────────────────────────────────

function HexLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <polygon
        points="14,2 25,8 25,20 14,26 3,20 3,8"
        fill="none"
        stroke="#06b6d4"
        strokeWidth="1.5"
      />
      <circle cx="14" cy="14" r="3" fill="#06b6d4" />
      <line x1="14" y1="2" x2="14" y2="5" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
      <line x1="14" y1="23" x2="14" y2="26" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
      <line x1="3" y1="8" x2="6" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
      <line x1="25" y1="8" x2="22" y2="9.5" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
      <line x1="3" y1="20" x2="6" y2="18.5" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
      <line x1="25" y1="20" x2="22" y2="18.5" stroke="#06b6d4" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'cyan' | 'emerald';
}) {
  const valueClass =
    accent === 'cyan'
      ? 'text-cyan-400'
      : accent === 'emerald'
      ? 'text-emerald-400'
      : 'text-zinc-100';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-center">
      <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 py-20 text-center">
      <div className="rounded-full border border-zinc-700 p-4">
        <svg className="h-6 w-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-400">No research jobs yet</p>
        <p className="text-xs text-zinc-600 mt-1">Submit a question to get started</p>
      </div>
    </div>
  );
}
