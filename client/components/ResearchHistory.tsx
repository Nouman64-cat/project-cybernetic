'use client';

import { ResearchProject } from '@/types/research';
import StatusBadge from './StatusBadge';

interface Props {
  projects: ResearchProject[];
  onViewReport: (projectId: string, title: string) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ResearchHistory({ projects, onViewReport }: Props) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 py-32 text-center">
        <div className="h-16 w-16 rounded-2xl border border-gray-200 bg-gray-50 flex items-center justify-center">
          <svg className="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">No research yet</p>
          <p className="text-xs text-gray-400 mt-1">Start a new research from the New Research page</p>
        </div>
      </div>
    );
  }

  const completed = projects.filter(p => p.status === 'completed');
  const active = projects.filter(p => p.status === 'pending' || p.status === 'in_progress');
  const failed = projects.filter(p => p.status === 'failed');

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">Past Researches</h1>
        <p className="text-sm text-gray-500 mt-1">
          {projects.length} total · {completed.length} completed · {active.length} active
          {failed.length > 0 && ` · ${failed.length} failed`}
        </p>
      </div>

      {/* Active researches */}
      {active.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">In Progress</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {active.map(p => (
              <HistoryCard key={p.project_id} project={p} onViewReport={onViewReport} />
            ))}
          </div>
        </section>
      )}

      {/* Completed researches */}
      {completed.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Completed</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {completed.map(p => (
              <HistoryCard key={p.project_id} project={p} onViewReport={onViewReport} />
            ))}
          </div>
        </section>
      )}

      {/* Failed researches */}
      {failed.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Failed</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {failed.map(p => (
              <HistoryCard key={p.project_id} project={p} onViewReport={onViewReport} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HistoryCard({ project, onViewReport }: { project: ResearchProject; onViewReport: (id: string, title: string) => void }) {
  const { project_id, title, status, created_at } = project;
  const isActive = status === 'pending' || status === 'in_progress';
  const isCompleted = status === 'completed';

  return (
    <div className={`group rounded-xl border bg-white p-4 transition-all duration-150
      ${isActive ? 'border-cyan-200 shadow-sm shadow-cyan-50' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}
    `}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          {isActive && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600">Live</span>
            </div>
          )}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{title}</h3>
          <p className="text-[11px] text-gray-400 mt-1">{timeAgo(created_at)}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {isCompleted && (
        <button
          onClick={() => onViewReport(project_id, title)}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-900 bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700 transition active:scale-95"
        >
          View Report
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {isActive && (
        <div className="flex items-center justify-center gap-2 py-1">
          <svg className="h-3.5 w-3.5 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-[11px] text-cyan-600">Agents working…</span>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-500 py-1">
          <span>✕</span>
          <span>Pipeline failed</span>
        </div>
      )}
    </div>
  );
}
