/**
 * Lightweight markdown → HTML renderer for inline use in agent conversation bubbles.
 * Keeps margins tight (no block-level spacing) so it fits compact UI cards.
 */
export function renderMarkdownInline(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headings — rendered as bold labels, no large spacing
  s = s.replace(
    /^### (.+)$/gm,
    '<span style="display:block;font-size:0.7rem;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.04em;margin:6px 0 2px;">$1</span>',
  );
  s = s.replace(
    /^## (.+)$/gm,
    '<span style="display:block;font-size:0.75rem;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:2px;margin:8px 0 4px;">$1</span>',
  );
  s = s.replace(
    /^# (.+)$/gm,
    '<span style="display:block;font-size:0.8rem;font-weight:800;color:#0f172a;margin:6px 0 4px;">$1</span>',
  );

  // Inline
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong style="font-weight:700;"><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:700;color:#1e293b;">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em style="font-style:italic;color:#475569;">$1</em>');
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:0 4px;font-size:.8em;font-family:monospace;color:#0e7490;">$1</code>',
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0891b2;text-decoration:underline;">$1</a>',
  );

  // Bullet lists
  s = s.replace(
    /^[-*] (.+)$/gm,
    '<div style="display:flex;gap:6px;margin-bottom:3px;align-items:flex-start;">' +
    '<span style="flex-shrink:0;margin-top:6px;width:5px;height:5px;border-radius:50%;background:#06b6d4;display:inline-block;"></span>' +
    '<span>$1</span></div>',
  );

  // Numbered lists
  s = s.replace(
    /^(\d+)\. (.+)$/gm,
    '<div style="display:flex;gap:6px;margin-bottom:3px;">' +
    '<span style="flex-shrink:0;font-weight:600;color:#64748b;min-width:1.2em;font-size:.8rem;">$1.</span>' +
    '<span>$2</span></div>',
  );

  // Horizontal rule
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:6px 0;">');

  // Line breaks — double newline → paragraph break, single → line break
  s = s.replace(/\n{2,}/g, '<br><br>');
  s = s.replace(/\n(?!<)/g, '<br>');

  return s;
}

/**
 * Full-fidelity markdown → HTML for the report viewer.
 * Uses block-level spacing suitable for a document reading layout.
 */
export function renderMarkdownFull(raw: string): string {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:20px 0;overflow-x:auto;font-size:13px;font-family:\'Geist Mono\',ui-monospace,monospace;line-height:1.6;color:#1e293b;"><code>$1</code></pre>',
  );
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:2px 6px;font-size:0.85em;font-family:\'Geist Mono\',ui-monospace,monospace;color:#0e7490;">$1</code>',
  );

  s = s.replace(
    /^# (.+)$/gm,
    '<h1 style="font-size:2rem;font-weight:800;line-height:1.25;color:#0f172a;margin:0 0 2rem;letter-spacing:-0.02em;border-bottom:3px solid #06b6d4;padding-bottom:1rem;">$1</h1>',
  );
  s = s.replace(
    /^## (.+)$/gm,
    '<h2 style="font-size:1.25rem;font-weight:700;line-height:1.35;color:#0f172a;margin:2.5rem 0 1rem;padding-bottom:0.5rem;border-bottom:1px solid #f1f5f9;">$1</h2>',
  );
  s = s.replace(
    /^### (.+)$/gm,
    '<h3 style="font-size:1rem;font-weight:600;color:#1e293b;margin:1.75rem 0 0.75rem;">$1</h3>',
  );

  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong style="font-weight:700;color:#0f172a;"><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:700;color:#0f172a;">$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em style="font-style:italic;color:#334155;">$1</em>');
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0891b2;text-decoration:none;border-bottom:1px solid #bae6fd;padding-bottom:1px;font-weight:500;">$1</a>',
  );
  s = s.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #f1f5f9;margin:2rem 0;">');

  s = s.replace(
    /^[-*] (.+)$/gm,
    '<li style="margin-bottom:0.5rem;padding-left:0.25rem;line-height:1.7;color:#334155;">$1</li>',
  );
  s = s.replace(
    /(<li[^>]*>[\s\S]*?<\/li>\n?)+/g,
    (match) =>
      `<ul style="margin:1rem 0 1rem 1.25rem;list-style:none;padding:0;">${match.replace(
        /<li style="([^"]*)">/g,
        '<li style="$1;list-style:none;position:relative;padding-left:1.25rem;"><span style="position:absolute;left:0;top:0.65em;width:6px;height:6px;border-radius:50%;background:#06b6d4;"></span>',
      )}</ul>`,
  );

  s = s.replace(/^(\d+)\. (.+)$/gm, '<li style="margin-bottom:0.5rem;line-height:1.7;color:#334155;">$2</li>');
  s = s.replace(
    /(<li style="[^"]*">(?!<span)[\s\S]*?<\/li>\n?)+/g,
    (match) => `<ol style="margin:1rem 0 1rem 1.5rem;list-style:decimal;color:#334155;">${match}</ol>`,
  );

  s = s.replace(
    /^> (.+)$/gm,
    '<blockquote style="margin:1.5rem 0;padding:1rem 1.25rem;border-left:3px solid #06b6d4;background:#f0f9ff;border-radius:0 8px 8px 0;color:#0c4a6e;font-style:italic;">$1</blockquote>',
  );

  const blocks = s.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const t = block.replace(/\n/g, ' ').trim();
      if (!t) return '';
      if (/^<(h[1-6]|pre|hr|ul|ol|li|blockquote)/.test(t)) return t;
      return `<p style="margin-bottom:1.25rem;line-height:1.8;color:#334155;">${t}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}
