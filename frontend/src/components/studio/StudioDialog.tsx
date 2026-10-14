'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Segmented, SliderWithInput, Switch } from '@lobehub/ui/base-ui'
import { BarChart3, Check, FileSpreadsheet, FileText, ListChecks, Loader2, Presentation, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileCard } from '@/components/files/FileCard'
import { StepTimeline } from '@/components/thoth/StepTimeline'
import { useLobeScopeClass } from '@/components/providers/LobeProvider'
import { AgentFile, followRun, RunEvent } from '@/lib/api/agent'
import { studioApi, StudioFormat, StudioKind, StudioOptions } from '@/lib/api/studio'
import { cn } from '@/lib/utils'

const KINDS: { id: StudioKind; label: string; desc: string; icon: typeof FileText }[] = [
  { id: 'presentation', label: 'Presentation', desc: 'Widescreen PowerPoint deck', icon: Presentation },
  { id: 'report', label: 'PDF report', desc: 'Short, medium or long', icon: FileText },
  { id: 'infographic', label: 'Infographic', desc: 'One-page visual', icon: BarChart3 },
  { id: 'spreadsheet', label: 'Excel dashboard', desc: 'Tables, formulas, charts', icon: FileSpreadsheet },
  { id: 'summary', label: 'Executive summary', desc: 'Short Word brief', icon: ListChecks },
]

const FORMATS: { id: StudioFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Word' },
  { id: 'pptx', label: 'PowerPoint' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'svg', label: 'SVG' },
  { id: 'html', label: 'HTML' },
  { id: 'md', label: 'Markdown' },
]

const DEFAULT_FORMAT: Record<StudioKind, StudioFormat> = { report: 'pdf', presentation: 'pptx', infographic: 'svg', summary: 'docx', spreadsheet: 'xlsx' }

const DEFAULT_OPTIONS: StudioOptions = {
  theme: 'graphite',
  template: 'default',
  slide_count: 10,
  length: 'medium',
  audience: 'senior leadership',
  tone: 'formal',
  speaker_notes: true,
  include_sources: true,
  instructions: '',
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}

interface StudioDialogProps {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StudioDialog({ notebookId, open, onOpenChange }: StudioDialogProps) {
  const qc = useQueryClient()
  const lobeScope = useLobeScopeClass()
  const { data: meta } = useQuery({ queryKey: ['studio-meta'], queryFn: studioApi.meta, enabled: open })
  const [kind, setKind] = useState<StudioKind>('presentation')
  const { data: templates = [] } = useQuery({ queryKey: ['studio-templates', kind], queryFn: () => studioApi.templates(kind), enabled: open })
  const [opts, setOpts] = useState<StudioOptions>(DEFAULT_OPTIONS)
  const [formats, setFormats] = useState<StudioFormat[]>(['pptx'])
  const [events, setEvents] = useState<RunEvent[]>([])
  const [files, setFiles] = useState<AgentFile[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setFormats([DEFAULT_FORMAT[kind]])
  }, [kind])

  const set = <K extends keyof StudioOptions>(k: K, v: StudioOptions[K]) => setOpts((o) => ({ ...o, [k]: v }))

  const generate = async () => {
    if (!formats.length) return toast.error('Pick at least one format')
    setRunning(true)
    setEvents([])
    setFiles([])
    setMessage(null)
    setError(null)
    try {
      const job = await studioApi.job({ notebook_id: notebookId, kind, formats, options: { ...opts, instructions: opts.instructions || null } })
      await followRun(job.id, (evs) => {
        setEvents((e) => [...e, ...evs])
        for (const ev of evs) {
          if (ev.type === 'file') setFiles((f) => (f.some((x) => x.id === ev.file.id) ? f : [...f, ev.file]))
          if (ev.type === 'message') setMessage(ev.content)
          if (ev.type === 'error') setError(ev.message)
        }
      })
      qc.invalidateQueries({ queryKey: ['studio-files'] })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'The job could not start')
    } finally {
      setRunning(false)
    }
  }

  const toggleFormat = (f: StudioFormat) => setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-6xl', lobeScope)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="h-4 w-4" /> Studio</DialogTitle>
          <DialogDescription>Turn this notebook into a finished document. Every file is audited before delivery.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {KINDS.map((k) => (
                <button key={k.id} type="button" disabled={running} onClick={() => setKind(k.id)} className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors', kind === k.id ? 'border-foreground/25 bg-muted' : 'hover:bg-muted/50')}>
                  <k.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{k.label}</span>
                  <span className="text-xs text-muted-foreground">{k.desc}</span>
                </button>
              ))}
            </div>

            <Field label="Template" hint={opts.template === 'default' ? 'Approved house template, generated directly.' : 'Uses a reference design from the library, then audits until clean.'}>
              <div className="grid grid-cols-2 gap-2">
                {templates.map((t) => (
                  <button key={t.id} type="button" onClick={() => setOpts((o) => ({ ...o, template: t.id, theme: t.id === 'default' ? o.theme : t.theme }))} className={cn('flex flex-col gap-0.5 rounded-xl border p-2.5 text-left', opts.template === t.id ? 'border-foreground/30 bg-muted' : 'hover:bg-muted/50')}>
                    <span className="flex items-center justify-between text-xs font-medium">{t.name}{opts.template === t.id && <Check className="h-3.5 w-3.5" />}</span>
                    <span className="text-[11px] text-muted-foreground">{t.description}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Style">
              <div className="grid grid-cols-3 gap-2">
                {(meta?.themes ?? []).map((t) => (
                  <button key={t.id} type="button" title={t.description} onClick={() => set('theme', t.id)} className={cn('flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors', opts.theme === t.id ? 'border-foreground/30 bg-muted' : 'hover:bg-muted/50')}>
                    <div className="flex h-7 overflow-hidden rounded-md">
                      <span className="flex-[3]" style={{ background: `#${t.colors[0]}` }} />
                      <span className="flex-[2]" style={{ background: `#${t.colors[3]}` }} />
                      <span className="flex-1" style={{ background: `#${t.colors[2]}` }} />
                    </div>
                    <span className="flex items-center justify-between text-xs font-medium">{t.name}{opts.theme === t.id && <Check className="h-3.5 w-3.5" />}</span>
                  </button>
                ))}
              </div>
            </Field>

            {kind === 'presentation' ? (
              <Field label="Number of slides" hint="Includes the cover, agenda and closing slides.">
                <SliderWithInput min={4} max={20} step={1} value={opts.slide_count} onChange={(v) => set('slide_count', Number(v) || 10)} />
              </Field>
            ) : (
              <Field label="Length" hint={kind === 'report' ? 'Short: 2-4 pages. Medium: 3-9 pages. Long: each section written in its own pass, 6+ pages.' : undefined}>
                <Segmented block value={opts.length} onChange={(v) => set('length', v as StudioOptions['length'])} options={[{ label: 'Short', value: 'short' }, { label: 'Medium', value: 'medium' }, { label: 'Long', value: 'long' }]} />
              </Field>
            )}

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {kind === 'presentation' && (
                <label className="flex items-center gap-2 text-sm"><Switch size="small" checked={opts.speaker_notes} onChange={(v) => set('speaker_notes', v)} /> Speaker notes</label>
              )}
              <label className="flex items-center gap-2 text-sm"><Switch size="small" checked={opts.include_sources} onChange={(v) => set('include_sources', v)} /> List sources</label>
            </div>

            <Field label="Formats">
              <div className="flex flex-wrap gap-1.5">
                {FORMATS.map((f) => (
                  <button key={f.id} type="button" onClick={() => toggleFormat(f.id)} className={cn('rounded-lg border px-2.5 py-1 text-xs transition-colors', formats.includes(f.id) ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}>{f.label}</button>
                ))}
              </div>
            </Field>

            <Button onClick={generate} disabled={running} className="h-10 rounded-xl">
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : events.length ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {running ? 'Working' : events.length ? 'Generate again' : 'Generate'}
            </Button>
          </div>

          <div className="flex min-h-[460px] flex-col gap-3 rounded-2xl bg-muted/50 p-4">
            {!events.length && !running && (
              <div className="m-auto flex max-w-xs flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4" /> Progress and files appear here
              </div>
            )}
            {(events.length > 0 || running) && <StepTimeline events={events} running={running} />}
            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                {files.map((f) => <FileCard key={f.id} file={f} />)}
              </div>
            )}
            {message && <p className="text-sm">{message}</p>}
            {error && <p className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
