import { apiClient } from './client'
import type { AgentFile } from './agent'
import type { StudioDocument } from './studio'

export interface SheetTable {
  name: string
  columns: string[]
  rows: (string | number | null)[][]
}

export interface EditorPayload {
  file: AgentFile
  mode: 'deck' | 'document' | 'sheet' | 'pdf' | 'text' | 'readonly'
  pdf_tools: boolean
  document?: StudioDocument
  tables?: SheetTable[]
  text?: string
  pages?: number
}

export interface SaveResult {
  file: AgentFile
  audit_issues: string[]
}

export const editorApi = {
  open: async (id: string) => (await apiClient.get<EditorPayload>(`/editor/files/${id}`)).data,
  saveDocument: async (id: string, document: StudioDocument) =>
    (await apiClient.put<SaveResult>(`/editor/files/${id}/document`, { document })).data,
  saveSheet: async (id: string, tables: SheetTable[], title?: string) =>
    (await apiClient.put<SaveResult>(`/editor/files/${id}/sheet`, { tables, title })).data,
  saveText: async (id: string, text: string) =>
    (await apiClient.put<SaveResult>(`/editor/files/${id}/text`, { text })).data,
  pageImage: async (id: string, page: number, version: number) =>
    URL.createObjectURL(
      (await apiClient.get(`/editor/files/${id}/pages/${page}.png`, { params: { v: version }, responseType: 'blob' })).data as Blob
    ),
  reorderPages: async (id: string, order: number[]) =>
    (await apiClient.post<SaveResult>(`/editor/files/${id}/pages`, { order })).data,
  create: async (format: 'pptx' | 'xlsx' | 'pdf' | 'docx' | 'md', title: string) =>
    (await apiClient.post<AgentFile>('/editor/new', { format, title })).data,
}
