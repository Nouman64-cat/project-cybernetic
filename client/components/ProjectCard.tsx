'use client';

import { ResearchProject } from '@/types/research';
import StatusBadge from './StatusBadge';

interface Props {
  project: ResearchProject;
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

export default function ProjectCard({ project, onViewReport }: Props) {
  const { project_id, title, status, created_at } = project;
  const isActive = status === 'pending' || status === 'in_progress';

  return (
    <div
      className={`group relative rounded-xl border bg-zinc-900 p-4 transition-all ${
        isActive
          ? 'border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.08)]'
          : status === 'completed'
          ? 'border-zinc-700 hover:border-zinc-600'
          : 'border-zinc-700/60'
      }`}
    >
      {/* Animated top-edge glow for active jobs */}
      {isActive && (
        <div className="absolute inset-x-0 top-0 h-px rounded-t-xl bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-sm font-medium text-zinc-100">{title}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{timeAgo(created_at)}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Footer row */}
      <div className="mt-3 flex items-center justify-between">
        {isActive && (
          <p className="flex items-center gap-1.5 text-xs text-cyan-400/80">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
            Agents are working…
          </p>
        )}
        {status === 'failed' && (
          <p className="text-xs text-red-400">Pipeline failed — check worker logs</p>
        )}
        {status === 'completed' && (
          <>
            <span />
            <button
              onClick={() => onViewReport(project_id, title)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-cyan-500/50 hover:bg-cyan-500/10 hover:text-cyan-400"
            >
              View Report →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
