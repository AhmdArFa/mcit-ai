'use client'

import { useState } from 'react'
import { FileTypeIcon } from '@lobehub/ui'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AgentFile, filesApi, formatBytes } from '@/lib/api/agent'
import { useFilePanel } from '@/lib/stores/file-panel-store'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = {
  report: 'Report',
  presentation: 'Presentation',
  infographic: 'Infographic',
  summary: 'Summary',
  spreadsheet: 'Spreadsheet',
}

export function FileCard({
  file,
  onDelete,
  className,
}: {
  file: AgentFile
  onDelete?: (id: string) => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const openPanel = useFilePanel((s) => s.open)

  const download = async () => {
    setBusy(true)
    try {
      await filesApi.download(file)
    } catch {
      toast.error('Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-muted/60',
        className
      )}
    >
      <FileTypeIcon filetype={file.format} size={34} variant="color" />
      <button type="button" onClick={() => openPanel(file.id)} className="flex min-w-0 flex-1 flex-col text-left" aria-label={`Open ${file.filename}`}>
        <span className="truncate text-sm font-medium">{file.filename}</span>
        <span className="truncate text-xs text-muted-foreground">
          {KIND_LABEL[file.kind] ?? file.kind} · {file.format.toUpperCase()} · {formatBytes(file.size)}{file.version && file.version > 1 ? ` · v${file.version}` : ''}
          {file.notebook_name ? ` · ${file.notebook_name}` : ''}
        </span>
      </button>
      <button
        type="button"
        onClick={download}
        aria-label={`Download ${file.filename}`}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(file.id)}
          aria-label={`Delete ${file.filename}`}
          className="rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
