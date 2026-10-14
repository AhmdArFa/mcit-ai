import { apiClient } from './client'
import type { AgentFile } from './agent'

export type StudioKind = 'report' | 'presentation' | 'infographic' | 'summary' | 'spreadsheet'
export type StudioFormat = 'pdf' | 'docx' | 'pptx' | 'svg' | 'xlsx' | 'html' | 'md' | 'txt' | 'json'

export interface StudioOptions {
  theme: string
  slide_count: number
  length: 'short' | 'medium' | 'long'
  template: string
  audience: string
  tone: 'formal' | 'neutral' | 'persuasive' | 'plain'
  speaker_notes: boolean
  include_sources: boolean
  instructions?: string | null
}

export interface StudioSlide {
  layout: string
  title: string
  subtitle: string
  bullets: string[]
  left_title: string
  left: string[]
  right_title: string
  right: string[]
  stats: { value: string; label: string }[]
  steps: string[]
  quote: string
  chart_labels: string[]
  chart_values: number[]
  table_columns?: string[]
  table_rows?: (string | number | null)[][]
  image_path?: string
  image_caption?: string
  notes: string
}

export interface StudioDocument {
  kind: StudioKind
  title: string
  subtitle: string
  summary: string
  key_points: string[]
  stats: { value: string; label: string }[]
  sections: { heading: string; body: string; bullets: string[] }[]
  slides: StudioSlide[]
  recommendations: string[]
  conclusion: string
  tables: { name: string; columns: string[]; rows: (string | number | null)[][] }[]
  sources: string[]
  notebook_name: string
  options: StudioOptions
  generated_at: string
}

export interface StudioTheme {
  id: string
  name: string
  description: string
  colors: string[]
}

export interface StudioMeta {
  kinds: StudioKind[]
  formats: StudioFormat[]
  default_format: Record<StudioKind, StudioFormat>
  themes: StudioTheme[]
}

export interface StudioTemplate {
  id: string
  name: string
  kinds: StudioKind[]
  theme: string
  brief: string
  description: string
}

export const studioApi = {
  templates: async (kind?: StudioKind) =>
    (await apiClient.get<StudioTemplate[]>('/studio/templates', { params: kind ? { kind } : {} })).data,
  job: async (params: { notebook_id: string; kind: StudioKind; formats: StudioFormat[]; options: StudioOptions; model_id?: string | null }) =>
    (await apiClient.post<{ id: string; status: string }>('/studio/jobs', params)).data,
  meta: async () => (await apiClient.get<StudioMeta>('/studio/formats')).data,

  generate: async (params: { notebook_id: string; kind: StudioKind; options: StudioOptions; model_id?: string }) =>
    (await apiClient.post<StudioDocument>('/studio/generate', params)).data,

  save: async (document: StudioDocument, formats: StudioFormat[], notebookId?: string) =>
    (await apiClient.post<AgentFile[]>('/studio/save', { document, formats, notebook_id: notebookId })).data,

  render: async (document: StudioDocument, format: StudioFormat): Promise<{ blob: Blob; filename: string }> => {
    const res = await apiClient.post('/studio/render', { document, format }, { responseType: 'blob' })
    const disposition = String(res.headers['content-disposition'] || '')
    const match = disposition.match(/filename="([^"]+)"/)
    return { blob: res.data as Blob, filename: match?.[1] || `MCIT-LM-${document.kind}.${format}` }
  },
}
