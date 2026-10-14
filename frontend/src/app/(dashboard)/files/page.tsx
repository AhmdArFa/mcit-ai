'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { editorApi } from '@/lib/api/editor'
import { useFilePanel } from '@/lib/stores/file-panel-store'
import { toast } from 'sonner'

import { AppShell } from '@/components/layout/AppShell'
import { FileCard } from '@/components/files/FileCard'
import { filesApi } from '@/lib/api/agent'
import { cn } from '@/lib/utils'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'presentation', label: 'Presentations' },
  { id: 'report', label: 'Reports' },
  { id: 'infographic', label: 'Infographics' },
  { id: 'spreadsheet', label: 'Spreadsheets' },
  { id: 'summary', label: 'Summaries' },
]

const NEW_TYPES = [
  { format: 'pptx', label: 'Presentation' },
  { format: 'xlsx', label: 'Spreadsheet' },
  { format: 'pdf', label: 'PDF document' },
  { format: 'docx', label: 'Word document' },
  { format: 'md', label: 'Markdown' },
] as const

export default function FilesPage() {
  const qc = useQueryClient()
  const { data: files = [], isLoading } = useQuery({ queryKey: ['studio-files'], queryFn: () => filesApi.list(), refetchInterval: 10000 })
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const openPanel = useFilePanel((st) => st.open)

  const createNew = async (format: (typeof NEW_TYPES)[number]['format']) => {
    setCreating(false)
    try {
      const item = await editorApi.create(format, 'Untitled')
      qc.invalidateQueries({ queryKey: ['studio-files'] })
      openPanel(item.id)
    } catch {
      toast.error('Could not create the file')
    }
  }

  const shown = useMemo(
    () =>
      files.filter(
        (f) =>
          (filter === 'all' || f.kind === filter) &&
          (!q || `${f.filename} ${f.notebook_name}`.toLowerCase().includes(q.toLowerCase()))
      ),
    [files, filter, q]
  )

  const remove = async (id: string) => {
    try {
      await filesApi.remove(id)
      qc.invalidateQueries({ queryKey: ['studio-files'] })
    } catch {
      toast.error('Could not delete the file')
    }
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
            <p className="text-sm text-muted-foreground">
              Every document created in Studio, by Thoth, or from scratch. Click a file to open it in its editor.
            </p>
          </div>
          <div className="relative self-start">
            <Button size="sm" onClick={() => setCreating((v) => !v)}><Plus className="mr-1.5 h-4 w-4" /> New file</Button>
            {creating && (
              <div className="absolute left-0 top-10 z-20 flex w-48 flex-col rounded-xl border bg-popover p-1 shadow-[var(--shadow-pop)]">
                {NEW_TYPES.map((t) => (
                  <button key={t.format} type="button" onClick={() => createNew(t.format)} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">{t.label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg bg-muted p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    filter === f.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search files"
                className="h-9 w-64 rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/30"
              />
            </div>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading files...</p>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No files yet</p>
              <p className="text-sm text-muted-foreground">Create one with New file, ask Thoth, or open Studio in a notebook.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {shown.map((f) => (
                <FileCard key={f.id} file={f} onDelete={remove} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
