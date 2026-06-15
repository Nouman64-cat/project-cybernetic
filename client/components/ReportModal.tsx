'use client';

import { useEffect, useRef, useState } from 'react';
import api from '@/lib/axios';
import { ResearchReport } from '@/types/research';
import { renderMarkdownFull } from '@/lib/markdown';

interface Props {
  projectId: string;
  title: string;
  onClose: () => void;
}

// kept for the print window which can't import modules
function renderMarkdown(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  s = s.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:20px 0;overflow-x:auto;font-size:13px;font-family:\'Geist Mono\',ui-monospace,monospace;line-height:1.6;color:#1e293b;"><code>$1</code></pre>',
  );
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:2px 6px;font-size:0.85em;font-family:\'Geist Mono\',ui-monospace,monospace;color:#0e7490;">$1</code>',
  );

  // Headings
  s = s.replace(
    /^# (.+)$/gm,
    '<h1 style="font-size:2rem;font-weight:800;line-height:1.25;color:#0f172a;margin:0 0 2rem;letter-spacing:-0.02em;border-bottom:3px solid #06b6d4;padding-bottom:1rem;">$1</h1>',
  );
  s = s.replace(
    /^## (.+)$/gm,
    '<h2 id="h-$1" style="font-size:1.25rem;font-weight:700;line-height:1.35;color:#0f172a;margin:2.5rem 0 1rem;padding-bottom:0.5rem;border-bottom:1px solid #f1f5f9;">$1</h2>',
  );
  s = s.replace(
    /^### (.+)$/gm,
    '<h3 style="font-size:1rem;font-weight:600;color:#1e293b;margin:1.75rem 0 0.75rem;">$1</h3>',
  );

  // Inline
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong style="font-weight:700;color:#0f172a;"><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:700;color:#0f172a;">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em style="font-style:italic;color:#334155;">$1</em>');
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0891b2;text-decoration:none;border-bottom:1px solid #bae6fd;padding-bottom:1px;font-weight:500;transition:color .15s;">$1</a>',
  );

  // Horizontal rule
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #f1f5f9;margin:2rem 0;">');

  // Bullet lists — group consecutive items
  s = s.replace(
    /^[-*] (.+)$/gm,
    '<li style="margin-bottom:0.5rem;padding-left:0.25rem;line-height:1.7;color:#334155;">$1</li>',
  );
  s = s.replace(
    /(<li[^>]*>[\s\S]*?<\/li>\n?)+/g,
    (match) => `<ul style="margin:1rem 0 1rem 1.25rem;list-style:none;padding:0;">${
      match.replace(/<li/g, '<li style="margin-bottom:0.5rem;padding-left:1.25rem;position:relative;line-height:1.7;color:#334155;">').replace(/<\/li>/g, '</li>')
        .replace(/<li style="([^"]*)">/g, '<li style="$1;list-style:none;"><span style="position:absolute;left:0;top:0.65em;width:6px;height:6px;border-radius:50%;background:#06b6d4;"></span>')
    }</ul>`,
  );

  // Numbered lists
  s = s.replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:0.5rem;line-height:1.7;color:#334155;">$2</li>');
  s = s.replace(
    /(<li style="[^"]*">(?!<span)[\s\S]*?<\/li>\n?)+/g,
    (match) => `<ol style="margin:1rem 0 1rem 1.5rem;list-style:decimal;color:#334155;">${match}</ol>`,
  );

  // Blockquotes
  s = s.replace(
    /^> (.+)$/gm,
    '<blockquote style="margin:1.5rem 0;padding:1rem 1.25rem;border-left:3px solid #06b6d4;background:#f0f9ff;border-radius:0 8px 8px 0;color:#0c4a6e;font-style:italic;">$1</blockquote>',
  );

  // Paragraphs
  const blocks = s.split(/\n{2,}/);
  const out = blocks.map((block) => {
    const t = block.replace(/\n/g, ' ').trim();
    if (!t) return '';
    if (/^<(h[1-6]|pre|hr|ul|ol|li|blockquote)/.test(t)) return t;
    return `<p style="margin-bottom:1.25rem;line-height:1.8;color:#334155;">${t}</p>`;
  });

  return out.filter(Boolean).join('\n');
}

// ── Extract TOC headings ─────────────────────────────────────────────────────
interface Heading { level: number; text: string; }

function extractHeadings(raw: string): Heading[] {
  const lines = raw.split('\n');
  const headings: Heading[] = [];
  for (const line of lines) {
    const m2 = line.match(/^## (.+)$/);
    const m3 = line.match(/^### (.+)$/);
    if (m2) headings.push({ level: 2, text: m2[1] });
    else if (m3) headings.push({ level: 3, text: m3[1] });
  }
  return headings;
}

// ── Print renderer ────────────────────────────────────────────────────────────
function renderMarkdownForPrint(raw: string): string {
  return renderMarkdownFull(raw);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReportModal({ projectId, title, onClose }: Props) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<ResearchReport>(`/api/research/report/${projectId}`)
      .then((r) => setReport(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Track scroll position to highlight active TOC item
  useEffect(() => {
    if (!report) return;
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const headings = el.querySelectorAll('h2');
      let current = '';
      headings.forEach((h) => {
        if (h.getBoundingClientRect().top < 160) current = h.textContent ?? '';
      });
      setActiveHeading(current);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [report]);

  function handleCopy() {
    if (!report) return;
    navigator.clipboard.writeText(report.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    if (!report) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to download the PDF.'); return; }
    const createdAt = new Date(report.created_at).toLocaleString();
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — Cybernetic Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: Georgia, serif; font-size: 15px; line-height: 1.75; color: #111827; max-width: 740px; margin: 0 auto; padding: 48px 32px; }
    .brand { font-family: system-ui, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: #0891b2; margin-bottom: 12px; }
    .report-title { font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 6px; line-height: 1.3; }
    .meta { font-family: system-ui, sans-serif; font-size: 12px; color: #6b7280; border-bottom: 2px solid #06b6d4; padding-bottom: 20px; margin-bottom: 32px; }
    a { color: #0891b2; }
    @media print { body { padding: 20px; } @page { margin: 1.5cm; } }
  </style>
</head>
<body>
  <p class="brand">Cybernetic — Deep Research Intelligence</p>
  <h1 class="report-title">${title.replace(/</g, '&lt;')}</h1>
  <p class="meta">Generated ${createdAt}</p>
  ${renderMarkdownForPrint(report.content)}
</body>
</html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  const headings = report ? extractHeadings(report.content) : [];
  const sources = report?.sources ?? [];

  function scrollToHeading(text: string) {
    if (!contentRef.current) return;
    const els = contentRef.current.querySelectorAll('h2, h3');
    for (const el of Array.from(els)) {
      if (el.textContent === text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      {/* Clickable backdrop strip */}
      <div className="w-4 shrink-0 cursor-pointer" onClick={onClose} />

      {/* Main panel — slides in from right */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-l-2xl bg-white shadow-2xl">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="shrink-0 flex items-center gap-4 border-b border-gray-100 bg-white px-6 py-3.5 z-10">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
            Close
          </button>

          <div className="h-4 w-px bg-gray-200" />

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-600">Research Report</p>
            <h1 className="text-sm font-semibold text-gray-900 truncate leading-tight">{title}</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {report && (
              <span className="text-[11px] text-gray-400 hidden sm:block">
                {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}
            <button
              onClick={handleCopy}
              disabled={!report}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 disabled:opacity-40"
            >
              {copied ? (
                <><span className="text-emerald-500">✓</span> Copied</>
              ) : (
                <><ClipboardIcon /> Copy</>
              )}
            </button>
            <button
              onClick={handlePrint}
              disabled={!report}
              className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              <PrintIcon /> PDF
            </button>
          </div>
        </header>

        {/* ── Content area ────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left sidebar — TOC + sources */}
          {report && (
            <aside className="w-56 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50/50 px-4 py-6 hidden lg:block">

              {/* Table of contents */}
              {headings.length > 0 && (
                <div className="mb-6">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-3">Contents</p>
                  <nav className="space-y-0.5">
                    {headings.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => scrollToHeading(h.text)}
                        className={`block w-full text-left rounded-md px-2 py-1 text-[11px] leading-snug transition-colors ${
                          activeHeading === h.text
                            ? 'bg-cyan-50 text-cyan-700 font-semibold'
                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                        } ${h.level === 3 ? 'pl-5' : ''}`}
                      >
                        {h.text}
                      </button>
                    ))}
                  </nav>
                </div>
              )}

              {/* Sources */}
              {sources.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-3">Sources</p>
                  <ol className="space-y-2">
                    {sources.slice(0, 15).map((src, i) => {
                      const url = Object.values(src)[0] ?? '#';
                      const label = Object.keys(src)[0] ?? url;
                      return (
                        <li key={i} className="flex items-start gap-2">
                          <span className="shrink-0 mt-0.5 h-4 w-4 rounded bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500">
                            {i + 1}
                          </span>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-cyan-700 hover:underline leading-snug break-all"
                          >
                            {label}
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </aside>
          )}

          {/* Main report content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex flex-col items-center justify-center gap-4 py-32 text-gray-400">
                <svg className="h-7 w-7 animate-spin text-cyan-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <p className="text-sm">Loading report…</p>
              </div>
            )}

            {error && (
              <div className="m-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {report && (
              <div className="max-w-3xl mx-auto px-10 py-10">
                {/* Report byline */}
                <div className="flex items-center gap-2 mb-8 pb-6 border-b border-gray-100">
                  <span className="h-5 w-5 rounded-full bg-cyan-500 flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">Cybernetic Research</p>
                    <p className="text-[11px] text-gray-400">
                      Generated {new Date(report.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                      {sources.length > 0 && ` · ${sources.length} source${sources.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>

                {/* Rendered content */}
                <div
                  dangerouslySetInnerHTML={{ __html: renderMarkdownFull(report.content) }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ClipboardIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 3.5A1.5 1.5 0 018.5 2h3A1.5 1.5 0 0113 3.5V4h-2.5A2.5 2.5 0 008 6.5V12H7a2 2 0 01-2-2V4a2 2 0 012-2z" />
      <path d="M10.5 5h3A1.5 1.5 0 0115 6.5v9A1.5 1.5 0 0113.5 17h-5A1.5 1.5 0 017 15.5v-9A1.5 1.5 0 018.5 5h2z" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}
