'use client';

import { ResearchStatus } from '@/types/research';

const CONFIG: Record<ResearchStatus, { label: string; classes: string; dot: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-amber-50 text-amber-700 ring-amber-200',
    dot: 'bg-amber-500',
  },
  in_progress: {
    label: 'Researching',
    classes: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    dot: 'bg-cyan-500 animate-pulse',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-50 text-red-700 ring-red-200',
    dot: 'bg-red-500',
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
