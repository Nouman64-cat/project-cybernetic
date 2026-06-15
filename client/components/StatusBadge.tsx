'use client';

import { ResearchStatus } from '@/types/research';

const CONFIG: Record<ResearchStatus, { label: string; classes: string; dot: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-amber-400/10 text-amber-400 ring-amber-400/20',
    dot: 'bg-amber-400',
  },
  in_progress: {
    label: 'Researching',
    classes: 'bg-cyan-400/10 text-cyan-400 ring-cyan-400/20',
    dot: 'bg-cyan-400 animate-pulse',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-400/10 text-emerald-400 ring-emerald-400/20',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-400/10 text-red-400 ring-red-400/20',
    dot: 'bg-red-400',
  },
};

export default function StatusBadge({ status }: { status: ResearchStatus }) {
  const { label, classes, dot } = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
