'use client';

import { FormEvent, useState } from 'react';
import api from '@/lib/axios';
import { StartResearchPayload, StartResearchResponse, ResearchProject } from '@/types/research';

interface Props {
  onSubmitted: (project: ResearchProject) => void;
}

export default function NewResearchForm({ onSubmitted }: Props) {
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [maxResults, setMaxResults] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const resolvedTitle = title.trim() || query.trim().slice(0, 60);
    setSubmitting(true);
    setError(null);

    try {
      const payload: StartResearchPayload = {
        title: resolvedTitle,
        query: query.trim(),
        max_results: maxResults,
      };

      const { data } = await api.post<StartResearchResponse>('/api/research/start', payload);

      onSubmitted({
        project_id: data.project_id,
        title: resolvedTitle,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: null,
      });

      setQuery('');
      setTitle('');
      setMaxResults(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Query */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Research question <span className="text-cyan-600">*</span>
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to research? Be specific — the agents work best with a clear question."
          rows={4}
          required
          className="w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      {/* Title + max results row */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            Title <span className="text-gray-400">(auto-filled if blank)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short display name"
            maxLength={100}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <div className="w-28">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Sources</label>
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || !query.trim()}
        className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Spinner />
            Dispatching agents…
          </>
        ) : (
          <>
            <span>Start Research</span>
            <ArrowRight />
          </>
        )}
      </button>
    </form>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
    </svg>
  );
}
