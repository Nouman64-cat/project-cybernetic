'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/axios';
import { ResearchReport } from '@/types/research';

interface Props {
  projectId: string;
  title: string;
  onClose: () => void;
}

// Minimal markdown → HTML renderer.
// Handles the structures the SynthesizerAgent reliably produces.
// HTML is escaped first so LLM output cannot inject arbitrary tags.
function renderMarkdown(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  s = s.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre class="my-4 overflow-x-auto rounded-lg bg-zinc-800 p-4 text-sm text-zinc-200 font-mono"><code>$1</code></pre>',
  );

  // Inline code
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-zinc-800 px-1.5 py-0.5 text-sm text-cyan-400 font-mono">$1</code>',
  );

  // Headings
  s = s.replace(/^### (.+)$/gm, '<h3 class="mt-6 mb-2 text-base font-semibold text-zinc-100">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 class="mt-8 mb-3 border-b border-zinc-700 pb-2 text-lg font-bold text-zinc-100">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 class="mb-6 mt-2 text-2xl font-bold text-white">$1</h1>');

  // Bold / italic
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-semibold text-zinc-100">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em class="italic text-zinc-300">$1</em>');

  // Links
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">$1</a>',
  );

  // Horizontal rule
  s = s.replace(/^---$/gm, '<hr class="my-6 border-zinc-700">');

  // List items (unordered)
  s = s.replace(
    /^[-*] (.+)$/gm,
    '<li class="mb-1 flex gap-2"><span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400"></span><span>$1</span></li>',
  );

  // Numbered list items
  s = s.replace(/^(\d+)\. (.+)$/gm, '<li class="mb-1 ml-4 list-decimal">$2</li>');

  // Paragraphs — two or more newlines become a paragraph break
  s = s.replace(/\n{2,}/g, '</p><p class="mb-4 leading-7 text-zinc-300">');

  // Single newlines
  s = s.replace(/\n/g, '<br>');

  return `<div class="prose-synaptic"><p class="mb-4 leading-7 text-zinc-300">${s}</p></div>`;
}

export default function ReportModal({ projectId, title, onClose }: Props) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<ResearchReport>(`/api/research/report/${projectId}`)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  function handleCopy() {
    if (!report) return;
    navigator.clipboard.writeText(report.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 pt-16"
      onClick={handleBackdrop}
    >
      <div className="relative w-full max-w-4xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-zinc-700 bg-zinc-900 px-6 py-4">
          <div>
            <p className="text-xs text-cyan-400 font-medium mb-0.5">Research Report</p>
            <h2 className="text-base font-semibold text-zinc-100 leading-tight">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!report}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
            >
              {copied ? 'Copied!' : 'Copy markdown'}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
              aria-label="Close"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6 min-h-64">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-500">
              <svg className="h-6 w-6 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm">Loading report…</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {report && (
            <div
              className="text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
            />
          )}
        </div>

        {/* Footer — created at */}
        {report && (
          <div className="rounded-b-xl border-t border-zinc-700 px-6 py-3 text-xs text-zinc-500">
            Generated {new Date(report.created_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
