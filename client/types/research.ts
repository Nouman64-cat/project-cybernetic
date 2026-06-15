export type ResearchStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ResearchProject {
  project_id: string;
  title: string;
  status: ResearchStatus;
  created_at: string;
  updated_at: string | null;
}

export interface StartResearchPayload {
  title: string;
  query: string;
  max_results?: number;
}

export interface StartResearchResponse {
  project_id: string;
  status: ResearchStatus;
  message: string;
}

export interface ResearchReport {
  project_id: string;
  report_id: string;
  content: string;       // synthesised markdown
  sources: Record<string, string>[];
  created_at: string;
}

export type StreamEventType =
  | 'phase'           // phase transition heading
  | 'search'          // web_search tool call
  | 'extract'         // extract_page_content tool call
  | 'phase_end'       // researcher compiled findings
  | 'draft_preview'   // synthesizer draft: first 38 words + word count
  | 'critic_feedback' // critic full revision notes
  | 'approved'        // critic approved
  | 'complete'        // pipeline done
  | 'error'           // pipeline error
  // legacy aliases kept for backwards compat with any cached streams
  | 'writing'
  | 'revision'
  | 'review';

export interface StreamEvent {
  type: StreamEventType;
  agent: string;
  content: string;
  ts: string;
}
