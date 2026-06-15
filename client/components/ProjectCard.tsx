'use client';

import { ResearchProject } from '@/types/research';
import StatusBadge from './StatusBadge';
import StreamFeed from './StreamFeed';

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
      className={`group relative rounded-xl border bg-white p-4 transition-all shadow-sm ${
        isActive
          ? 'border-cyan-300 shadow-cyan-100 shadow-md'
          : status === 'completed'
          ? 'border-gray-200 hover:border-gray-300 hover:shadow-md'
          : 'border-gray-200 opacity-75'
      }`}
    >
      {/* Animated top-edge accent for active jobs */}
      {isActive && (
        <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-sm font-medium text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-400">{timeAgo(created_at)}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Live agent feed — shown while the job is running */}
      <StreamFeed projectId={project_id} active={isActive} />

      <div className="mt-3 flex items-center justify-between">
        {isActive && (
          <p className="flex items-center gap-1.5 text-xs text-cyan-600">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-ping" />
            Agents are working…
          </p>
        )}
        {status === 'failed' && (
          <p className="text-xs text-red-600">Pipeline failed — check worker logs</p>
        )}
        {status === 'completed' && (
          <>
            <span />
            <button
              onClick={() => onViewReport(project_id, title)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-700"
            >
              View Report →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
