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
