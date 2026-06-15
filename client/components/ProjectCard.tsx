'use client';

import { ResearchProject } from '@/types/research';
import StatusBadge from './StatusBadge';
import AgentConversation from './AgentConversation';

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
  const isCompleted = status === 'completed';

  return (
    <div
      className={`relative rounded-2xl border bg-white transition-all duration-200 overflow-hidden
        ${isActive
          ? 'border-cyan-300 shadow-lg shadow-cyan-100/60'
          : isCompleted
          ? 'border-gray-200 hover:border-gray-300 hover:shadow-md'
          : 'border-gray-200 opacity-70'
        }`}
    >
      {/* Active top accent line */}
      {isActive && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
      )}

      <div className="p-4">
        {/* Top row: title + badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                  <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
              {title}
            </h3>
            <p className="mt-0.5 text-[11px] text-gray-400">{timeAgo(created_at)}</p>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Agent conversation — shown while active */}
        {isActive && (
          <AgentConversation projectId={project_id} active={isActive} />
        )}

        {/* Bottom action row */}
        <div className="mt-3 flex items-center justify-between">
          {isActive && (
            <p className="flex items-center gap-1.5 text-[11px] text-cyan-600">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-ping" />
              Agents working…
            </p>
          )}

          {status === 'failed' && (
            <p className="text-[11px] text-red-500">Pipeline failed — check worker logs</p>
          )}

          {isCompleted && (
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Complete
              </span>
              <button
                onClick={() => onViewReport(project_id, title)}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700 active:scale-95"
              >
                View Report
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
