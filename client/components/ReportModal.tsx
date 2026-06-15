'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/axios';
import { ResearchReport } from '@/types/research';

interface Props {
  projectId: string;
  title: string;
  onClose: () => void;
}

// Escape raw HTML first, then apply markdown patterns.
// Content comes from our own backend/LLM, but escaping prevents any
// accidental tag injection from model output.
// Text colour is NOT set on individual elements here — it is inherited from
// the wrapper div's `text-gray-700` class in JSX.  Setting it per-element
// inside dynamically built strings is unreliable because Tailwind may not
// include those class names in the CSS bundle if it only sees them at runtime.
function renderMarkdown(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks — explicit colours are safe here as they appear
  // literally in the source file and Tailwind can scan them.
  s = s.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre class="my-4 overflow-x-auto rounded-lg bg-gray-100 border border-gray-200 p-4 text-sm font-mono text-gray-800"><code>$1</code></pre>',
  );
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code class="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono text-cyan-700">$1</code>',
  );

  // Block elements — colour inherited, only structure/spacing classes needed
  s = s.replace(/^### (.+)$/gm, '<h3 style="font-size:1rem;font-weight:600;margin:1.5rem 0 0.5rem;color:#111827;">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 style="font-size:1.125rem;font-weight:700;margin:2rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid #e5e7eb;color:#111827;">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 style="font-size:1.5rem;font-weight:700;margin:0.5rem 0 1.5rem;color:#111827;">$1</h1>');

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:600;color:#111827;">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em style="font-style:italic;">$1</em>');
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0891b2;text-decoration:underline;">$1</a>',
  );
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e5e7eb;margin:1.5rem 0;">');
  s = s.replace(
    /^[-*] (.+)$/gm,
    '<div style="display:flex;gap:0.5rem;margin-bottom:0.25rem;"><span style="margin-top:0.6rem;width:6px;height:6px;border-radius:50%;background:#06b6d4;flex-shrink:0;"></span><span>$1</span></div>',
  );
  s = s.replace(/^(\d+)\. (.+)$/gm, '<div style="margin-bottom:0.25rem;margin-left:1rem;">$1. $2</div>');

  // Split on double newlines into proper paragraphs — avoids broken nested <p> tags
  const paragraphs = s.split(/\n{2,}/);
  const wrapped = paragraphs
    .map((p) => {
      const trimmed = p.replace(/\n/g, '<br>').trim();
      if (!trimmed) return '';
      // Don't wrap block elements in <p>
      if (/^<(h[1-6]|pre|hr|div)/.test(trimmed)) return trimmed;
      return `<p style="margin-bottom:1rem;line-height:1.75;">${trimmed}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return wrapped;
}

// Separate renderer with inline styles for the print window (no Tailwind available there).
function renderMarkdownForPrint(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:16px;font-size:13px;overflow-x:auto;margin:16px 0;"><code>$1</code></pre>',
  );
  s = s.replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px;color:#0e7490;">$1</code>');
  s = s.replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:600;margin:24px 0 8px;color:#111827;">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;color:#111827;">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 style="font-size:26px;font-weight:700;margin:0 0 24px;color:#111827;">$1</h1>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:600;color:#111827;">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em style="font-style:italic;">$1</em>');
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:#0891b2;text-decoration:underline;">$1</a>',
  );
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">');
  s = s.replace(/^[-*] (.+)$/gm, '<li style="margin-bottom:4px;padding-left:4px;">$1</li>');
  s = s.replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:4px;margin-left:16px;list-style:decimal;">$2</li>');
  s = s.replace(/\n{2,}/g, '</p><p style="margin-bottom:16px;line-height:1.75;color:#374151;">');
  s = s.replace(/\n/g, '<br>');
  return `<p style="margin-bottom:16px;line-height:1.75;color:#374151;">${s}</p>`;
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

  function handleDownloadPdf() {
    if (!report) return;

    const win = window.open('', '_blank');
    if (!win) {
      alert('Please allow pop-ups for this site to download the PDF.');
      return;
    }

    const createdAt = new Date(report.created_at).toLocaleString();
    const bodyHtml = renderMarkdownForPrint(report.content);

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — Cybernetic Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 15px;
      line-height: 1.7;
      color: #111827;
      max-width: 780px;
      margin: 0 auto;
      padding: 48px 40px;
    }
    .report-header {
      border-bottom: 2px solid #06b6d4;
      padding-bottom: 20px;
      margin-bottom: 32px;
    }
    .report-header .brand {
      font-family: system-ui, sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0891b2;
      margin-bottom: 8px;
    }
    .report-header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #111827;
      line-height: 1.3;
      margin-bottom: 8px;
    }
    .report-header .meta {
      font-family: system-ui, sans-serif;
      font-size: 12px;
      color: #6b7280;
    }
    a { color: #0891b2; }
    @media print {
      body { padding: 24px; }
      a { color: #0891b2; }
      @page { margin: 1.5cm; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <p class="brand">Cybernetic — Deep Research Intelligence</p>
    <h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>
    <p class="meta">Generated ${createdAt}</p>
  </div>
  ${bodyHtml}
</body>
</html>`);

    win.document.close();
    win.focus();
    // Small delay lets the browser finish painting before the print dialog opens
    setTimeout(() => win.print(), 400);
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 pt-16"
      onClick={handleBackdrop}
    >
      <div className="relative w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <p className="text-xs text-cyan-600 font-semibold mb-0.5 uppercase tracking-wide">Research Report</p>
            <h2 className="text-base font-semibold text-gray-900 leading-tight">{title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!report}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-40"
            >
              {copied ? '✓ Copied' : 'Copy markdown'}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={!report}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-40"
            >
              <DownloadIcon />
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 p-1.5 text-gray-400 transition hover:border-gray-300 hover:text-gray-600"
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
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-400">
              <svg className="h-6 w-6 animate-spin text-cyan-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm">Loading report…</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {report && (
            <div
              className="text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
            />
          )}
        </div>

        {/* Footer */}
        {report && (
          <div className="rounded-b-xl border-t border-gray-100 bg-gray-50 px-6 py-3 text-xs text-gray-400">
            Generated {new Date(report.created_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}
