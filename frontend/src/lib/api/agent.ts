import { apiClient } from './client'

export interface AgentFile {
  id: string
  filename: string
  format: string
  kind: string
  title: string
  notebook_id?: string | null
  notebook_name?: string
  theme?: string
  size: number
  created: string
  updated?: string | null
  version?: number
  audit_issues?: string[]
}

export type RunEvent =
  | { seq: number; type: 'step'; id: string; title?: string; kind?: string; status: 'running' | 'done' | 'error' }
  | { seq: number; type: 'progress'; step_id: string | null; message: string }
  | { seq: number; type: 'skill'; name: string }
  | { seq: number; type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { seq: number; type: 'usage'; input_tokens: number; output_tokens: number; reasoning_tokens: number; calls: number; final?: boolean }
  | { seq: number; type: 'file'; file: AgentFile }
  | { seq: number; type: 'message'; content: string }
  | { seq: number; type: 'error'; message: string }

export interface RunUsage {
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  calls: number
}

export interface RunSnapshot {
  id: string
  kind: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  usage: RunUsage
  events: RunEvent[]
}

export interface Skill {
  id: string
  name: string
  description: string
  instructions: string
  source_url: string
  enabled: boolean
  builtin: boolean
}

export interface ModelCapabilities {
  id: string
  name: string
  provider: string
  type: string
  context_window: number | null
  max_context_window: number | null
  capabilities: string[]
  reasoning: boolean
  reasoning_levels: string[]
  vision: boolean
  tools: boolean | null
  source: string
}

export interface Attachment {
  source_id: string
  filename: string
  notebook_id: string
  status?: string
  size?: number
}

export const agentApi = {
  start: async (params: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    notebook_id?: string | null
    model_id?: string | null
    thinking?: string | null
    skill_ids?: string[] | null
    attachments?: { source_id: string; filename: string }[]
  }) => (await apiClient.post<{ id: string; status: string }>('/agent/runs', params)).data,
  poll: async (runId: string, after: number) =>
    (await apiClient.get<RunSnapshot>(`/agent/runs/${runId}`, { params: { after } })).data,
  cancel: async (runId: string) => {
    await apiClient.post(`/agent/runs/${runId}/cancel`)
  },
  attach: async (file: File, notebookId?: string | null) => {
    const form = new FormData()
    form.append('file', file)
    if (notebookId) form.append('notebook_id', notebookId)
    return (await apiClient.post<Attachment>('/agent/attachments', form)).data
  },
  listSkills: async () => (await apiClient.get<Skill[]>('/agent/skills')).data,
  createSkill: async (s: { name: string; instructions: string; description?: string; source_url?: string }) =>
    (await apiClient.post<Skill>('/agent/skills', s)).data,
  updateSkill: async (id: string, s: Partial<Skill>) => (await apiClient.patch<Skill>(`/agent/skills/${id}`, s)).data,
  deleteSkill: async (id: string) => {
    await apiClient.delete(`/agent/skills/${id}`)
  },
  capabilities: async (modelId: string) =>
    (await apiClient.get<ModelCapabilities>(`/models/${encodeURIComponent(modelId)}/capabilities`)).data,
}

/** Poll a run until it finishes, delivering new events as they arrive. */
export async function followRun(
  runId: string,
  onEvents: (events: RunEvent[], snap: RunSnapshot) => void,
  intervalMs = 1000
): Promise<RunSnapshot> {
  let after = -1
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const snap = await agentApi.poll(runId, after)
    if (snap.events.length) {
      after = snap.events[snap.events.length - 1].seq
      onEvents(snap.events, snap)
    }
    if (snap.status !== 'running') return snap
  }
}

export const filesApi = {
  list: async (notebookId?: string) =>
    (await apiClient.get<AgentFile[]>('/studio/files', { params: notebookId ? { notebook_id: notebookId } : {} })).data,
  blob: async (id: string) => (await apiClient.get(`/studio/files/${id}/download`, { responseType: 'blob' })).data as Blob,
  remove: async (id: string) => {
    await apiClient.delete(`/studio/files/${id}`)
  },
  download: async (file: AgentFile) => {
    const blob = await filesApi.blob(file.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}

export interface UsageRow {
  model: string
  provider: string
  model_id: string | null
  requests: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  errors: number
  last_used: string | null
}

export const usageApi = {
  summary: async () => (await apiClient.get<{ models: UsageRow[] }>('/usage/summary')).data.models,
  recent: async (limit = 40) =>
    (
      await apiClient.get<{
        events: { model: string; provider: string; feature: string; input_tokens: number; output_tokens: number; reasoning_tokens: number; error: string | null; created: string }[]
      }>('/usage/recent', { params: { limit } })
    ).data.events,
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatTokens(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}
