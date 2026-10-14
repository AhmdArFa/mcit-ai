'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileTypeIcon } from '@lobehub/ui'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { filesApi } from '@/lib/api/agent'
import { editorApi, EditorPayload, SheetTable } from '@/lib/api/editor'
import { studioApi, StudioDocument, StudioSlide } from '@/lib/api/studio'
import { useFilePanel } from '@/lib/stores/file-panel-store'
import { cn } from '@/lib/utils'

const LAYOUTS = ['bullets', 'cards', 'stats', 'chart', 'two_column', 'comparison', 'process', 'quote', 'table', 'image'] as const

const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean)
const joinLines = (v: string[] | undefined) => (v ?? []).join('\n')

function blankSlide(): StudioSlide {
  return {
    layout: 'bullets', title: 'New slide', subtitle: '', bullets: ['First point'], left_title: '', left: [],
    right_title: '', right: [], stats: [], steps: [], quote: '', chart_labels: [], chart_values: [],
    table_columns: ['Category', 'Value'], table_rows: [['Sample', '100']], image_path: '', image_caption: '', notes: '',
  }
}

/* ---------------------------------------------------------------- previews */

function useBlobUrl(fileId: string, version: number | undefined, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let u: string | null = null
    let cancelled = false
    filesApi.blob(fileId).then((b) => {
      if (cancelled) return
      u = URL.createObjectURL(b)
      setUrl(u)
    })
    return () => {
      cancelled = true
      if (u) URL.revokeObjectURL(u)
    }
  }, [fileId, version, enabled])
  return url
}

function SlidePreview({ slide, colors, index }: { slide: StudioSlide; colors: string[]; index: number }) {
  const [dark, primary, accent, soft] = colors.length ? colors : ['18181B', '18181B', '10A37F', 'F4F4F5']
  const items = slide.bullets.length ? slide.bullets : slide.steps.length ? slide.steps : [...slide.left, ...slide.right]
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border bg-white p-[4%] text-left" style={{ color: `#${dark}` }}>
      <div className="text-[clamp(10px,2.2vw,22px)] font-bold leading-tight" style={{ color: `#${primary}` }}>{slide.title}</div>
      <div className="mt-[3%] grid grid-cols-[1.5fr_1fr] gap-[4%]">
        <div className="flex flex-col gap-1">
          {slide.layout === 'stats'
            ? slide.stats.map((s, i) => (
                <div key={i} className="rounded-md px-2 py-1" style={{ background: `#${soft}` }}>
                  <div className="text-[clamp(10px,2vw,20px)] font-bold" style={{ color: `#${primary}` }}>{s.value}</div>
                  <div className="text-[clamp(7px,0.9vw,11px)] opacity-70">{s.label}</div>
                </div>
              ))
            : slide.layout === 'table'
              ? (
                <div className="overflow-hidden rounded border text-[clamp(6px,0.8vw,10px)]" style={{ borderColor: `#${soft}` }}>
                  <div className="flex font-semibold text-white px-1 py-0.5" style={{ background: `#${primary}` }}>
                    {(slide.table_columns ?? ['Col A', 'Col B']).slice(0, 3).map((c, i) => (
                      <span key={i} className="flex-1 truncate">{c}</span>
                    ))}
                  </div>
                  {(slide.table_rows ?? [['Val 1', 'Val 2']]).slice(0, 3).map((r, ri) => (
                    <div key={ri} className="flex px-1 py-0.5 border-t" style={{ borderColor: `#${soft}`, background: ri % 2 === 0 ? `#${soft}` : '#fff' }}>
                      {r.slice(0, 3).map((val, ci) => (
                        <span key={ci} className="flex-1 truncate">{String(val ?? '')}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )
            : slide.layout === 'image'
              ? (
                <div className="flex flex-col gap-1">
                  <div className="flex h-12 items-center justify-center rounded border bg-muted text-[9px] text-muted-foreground font-medium">
                    {slide.image_caption || 'Visual figure'}
                  </div>
                  {items.slice(0, 2).map((b, i) => (
                    <div key={i} className="flex gap-1.5 text-[clamp(7px,1vw,12px)]">
                      <span style={{ color: `#${accent}` }}>•</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              )
            : slide.layout === 'quote'
              ? <div className="text-[clamp(9px,1.4vw,16px)] italic" style={{ color: `#${primary}` }}>&ldquo;{slide.quote}&rdquo;</div>
              : items.slice(0, 6).map((b, i) => (
                  <div key={i} className="flex gap-1.5 text-[clamp(7px,1vw,12px)]">
                    <span style={{ color: `#${accent}` }}>•</span>
                    <span>{b}</span>
                  </div>
                ))}
        </div>
        <div className="flex items-center justify-center rounded-md text-[clamp(14px,3vw,36px)] font-bold" style={{ background: `#${soft}`, color: `#${accent}` }}>
          {slide.layout === 'chart' && slide.chart_values.length
            ? `${slide.chart_values.length} bars`
            : slide.layout === 'table'
              ? `${(slide.table_rows ?? []).length} rows`
              : slide.layout === 'image'
                ? 'IMG'
                : String(index + 1).padStart(2, '0')}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- deck editor */

function DeckEditor({ payload, onSaved }: { payload: EditorPayload; onSaved: (issues: string[]) => void }) {
  const [doc, setDoc] = useState<StudioDocument>(payload.document!)
  const [sel, setSel] = useState(0)
  const [saving, setSaving] = useState(false)
  const { data: meta } = useQuery({ queryKey: ['studio-meta'], queryFn: studioApi.meta })
  const colors = meta?.themes.find((t) => t.id === doc.options.theme)?.colors ?? []
  const slide = doc.slides[sel]

  const patchSlide = (p: Partial<StudioSlide>) =>
    setDoc((d) => ({ ...d, slides: d.slides.map((s, i) => (i === sel ? { ...s, ...p } : s)) }))
  const move = (dir: -1 | 1) => {
    const j = sel + dir
    if (j < 0 || j >= doc.slides.length) return
    setDoc((d) => {
      const slides = [...d.slides]
      ;[slides[sel], slides[j]] = [slides[j], slides[sel]]
      return { ...d, slides }
    })
    setSel(j)
  }
  const add = () => {
    setDoc((d) => {
      const slides = [...d.slides]
      slides.splice(sel + 1, 0, blankSlide())
      return { ...d, slides }
    })
    setSel(sel + 1)
  }
  const remove = () => {
    if (doc.slides.length <= 1) return toast.error('A deck needs at least one content slide')
    setDoc((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== sel) }))
    setSel(Math.max(0, sel - 1))
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await editorApi.saveDocument(payload.file.id, doc)
      onSaved(r.audit_issues)
    } catch {
      toast.error('Could not save the deck')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3">
        <Input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} className="h-8 text-sm font-medium" aria-label="Deck title" />
        <Input value={doc.subtitle} onChange={(e) => setDoc({ ...doc, subtitle: e.target.value })} placeholder="Subtitle" className="h-8 text-xs" />
        <div className="mt-2 text-[11px] font-medium text-muted-foreground">Cover, agenda and closing are added automatically</div>
        {doc.slides.map((s, i) => (
          <button key={i} type="button" onClick={() => setSel(i)} className={cn('rounded-md border p-1.5 text-left', i === sel ? 'border-foreground/40 bg-muted' : 'hover:bg-muted/50')}>
            <SlidePreview slide={s} colors={colors} index={i} />
            <div className="mt-1 truncate px-0.5 text-[11px]">{i + 1}. {s.title}</div>
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" /> Add slide</Button>
      </aside>
      {slide && (
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <SlidePreview slide={slide} colors={colors} index={sel} />
          <div className="flex flex-wrap items-center gap-2">
            <select value={slide.layout} onChange={(e) => patchSlide({ layout: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Layout">
              {LAYOUTS.map((l) => <option key={l} value={l}>{l.replace('_', ' ')}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={remove} aria-label="Delete slide"><Trash2 className="h-4 w-4" /></Button>
            <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save deck
            </Button>
          </div>
          <Input value={slide.title} onChange={(e) => patchSlide({ title: e.target.value })} aria-label="Slide title" />
          {['bullets', 'cards'].includes(slide.layout) && (
            <Textarea rows={6} value={joinLines(slide.bullets)} onChange={(e) => patchSlide({ bullets: lines(e.target.value) })} placeholder={slide.layout === 'cards' ? 'One card per line: Heading: sentence' : 'One bullet per line'} />
          )}
          {slide.layout === 'process' && (
            <Textarea rows={5} value={joinLines(slide.steps)} onChange={(e) => patchSlide({ steps: lines(e.target.value) })} placeholder="One step per line: Step: detail" />
          )}
          {['two_column', 'comparison'].includes(slide.layout) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Input value={slide.left_title} onChange={(e) => patchSlide({ left_title: e.target.value })} placeholder="Left heading" />
                <Textarea rows={5} value={joinLines(slide.left)} onChange={(e) => patchSlide({ left: lines(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-2">
                <Input value={slide.right_title} onChange={(e) => patchSlide({ right_title: e.target.value })} placeholder="Right heading" />
                <Textarea rows={5} value={joinLines(slide.right)} onChange={(e) => patchSlide({ right: lines(e.target.value) })} />
              </div>
            </div>
          )}
          {slide.layout === 'stats' && (
            <Textarea rows={4} value={slide.stats.map((s) => `${s.value} | ${s.label}`).join('\n')}
              onChange={(e) => patchSlide({ stats: lines(e.target.value).map((l) => { const [value, ...rest] = l.split('|'); return { value: value.trim(), label: rest.join('|').trim() } }) })}
              placeholder="One figure per line: 4,500 | villages connected" />
          )}
          {slide.layout === 'chart' && (
            <Textarea rows={5} value={slide.chart_labels.map((l, i) => `${l} | ${slide.chart_values[i] ?? ''}`).join('\n')}
              onChange={(e) => {
                const rows = lines(e.target.value).map((l) => l.split('|').map((x) => x.trim()))
                patchSlide({ chart_labels: rows.map((r) => r[0]), chart_values: rows.map((r) => Number(r[1]) || 0) })
              }}
              placeholder="One bar per line: Q1 | 600" />
          )}
          {slide.layout === 'quote' && (
            <Textarea rows={3} value={slide.quote} onChange={(e) => patchSlide({ quote: e.target.value })} placeholder="Quote" />
          )}
          {slide.layout === 'table' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Columns (comma-separated)</span>
              <Input
                value={(slide.table_columns ?? []).join(', ')}
                onChange={(e) => patchSlide({ table_columns: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                placeholder="Column 1, Column 2, Column 3"
              />
              <span className="text-xs text-muted-foreground">Rows (pipe-separated: val1 | val2 | val3)</span>
              <Textarea
                rows={5}
                value={(slide.table_rows ?? []).map((r) => r.join(' | ')).join('\n')}
                onChange={(e) => {
                  const r = lines(e.target.value).map((l) => l.split('|').map((x) => x.trim()))
                  patchSlide({ table_rows: r })
                }}
                placeholder="Value 1 | Value 2 | Value 3"
              />
            </div>
          )}
          {slide.layout === 'image' && (
            <div className="flex flex-col gap-2">
              <Input
                value={slide.image_path ?? ''}
                onChange={(e) => patchSlide({ image_path: e.target.value })}
                placeholder="Image file path"
              />
              <Input
                value={slide.image_caption ?? ''}
                onChange={(e) => patchSlide({ image_caption: e.target.value })}
                placeholder="Image caption"
              />
              <Textarea
                rows={4}
                value={joinLines(slide.bullets)}
                onChange={(e) => patchSlide({ bullets: lines(e.target.value) })}
                placeholder="Observations/bullets about the figure (one per line)"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Speaker notes</span>
            <Textarea rows={3} value={slide.notes} onChange={(e) => patchSlide({ notes: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- document editor */

function DocumentEditor({ payload, onSaved }: { payload: EditorPayload; onSaved: (issues: string[]) => void }) {
  const [doc, setDoc] = useState<StudioDocument>(payload.document!)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof StudioDocument>(k: K, v: StudioDocument[K]) => setDoc((d) => ({ ...d, [k]: v }))
  const secs = doc.sections
  const patchSec = (i: number, p: Partial<StudioDocument['sections'][number]>) =>
    set('sections', secs.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const moveSec = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= secs.length) return
    const next = [...secs]
    ;[next[i], next[j]] = [next[j], next[i]]
    set('sections', next)
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await editorApi.saveDocument(payload.file.id, doc)
      onSaved(r.audit_issues)
    } catch {
      toast.error('Could not save the document')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <Input value={doc.title} onChange={(e) => set('title', e.target.value)} className="text-base font-medium" aria-label="Title" />
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save
        </Button>
      </div>
      <Input value={doc.subtitle} onChange={(e) => set('subtitle', e.target.value)} placeholder="Subtitle" />
      <Textarea rows={4} value={doc.summary} onChange={(e) => set('summary', e.target.value)} placeholder="Summary" />
      <Textarea rows={3} value={joinLines(doc.key_points)} onChange={(e) => set('key_points', lines(e.target.value))} placeholder="Key points, one per line" />
      {secs.map((s, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-1">
            <Input value={s.heading} onChange={(e) => patchSec(i, { heading: e.target.value })} className="font-medium" aria-label="Section heading" />
            <Button size="sm" variant="ghost" onClick={() => moveSec(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => moveSec(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => set('sections', secs.filter((_, j) => j !== i))} aria-label="Delete section"><Trash2 className="h-4 w-4" /></Button>
          </div>
          <Textarea rows={5} value={s.body} onChange={(e) => patchSec(i, { body: e.target.value })} />
          <Textarea rows={3} value={joinLines(s.bullets)} onChange={(e) => patchSec(i, { bullets: lines(e.target.value) })} placeholder="Bullets, one per line" />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => set('sections', [...secs, { heading: 'New section', body: '', bullets: [] }])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add section
      </Button>
      <Textarea rows={3} value={joinLines(doc.recommendations)} onChange={(e) => set('recommendations', lines(e.target.value))} placeholder="Recommendations, one per line" />
      <Textarea rows={2} value={doc.conclusion} onChange={(e) => set('conclusion', e.target.value)} placeholder="Conclusion" />
    </div>
  )
}

/* ---------------------------------------------------------------- sheet editor */

function SheetEditor({ payload, onSaved }: { payload: EditorPayload; onSaved: (issues: string[]) => void }) {
  const [tables, setTables] = useState<SheetTable[]>(payload.tables?.length ? payload.tables : [{ name: 'Sheet1', columns: ['A', 'B'], rows: [['', '']] }])
  const [tab, setTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const t = tables[tab]
  const patch = (fn: (t: SheetTable) => SheetTable) => setTables((all) => all.map((x, i) => (i === tab ? fn(x) : x)))
  const cell = (r: number, c: number, v: string) =>
    patch((x) => ({ ...x, rows: x.rows.map((row, i) => (i === r ? row.map((val, j) => (j === c ? (v !== '' && !isNaN(Number(v)) ? Number(v) : v) : val)) : row)) }))
  const save = async () => {
    setSaving(true)
    try {
      const r = await editorApi.saveSheet(payload.file.id, tables)
      onSaved(r.audit_issues)
    } catch {
      toast.error('Could not save the workbook')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {tables.map((x, i) => (
          <button key={i} type="button" onClick={() => setTab(i)} className={cn('rounded-md px-2.5 py-1 text-xs', i === tab ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}>{x.name}</button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => { setTables([...tables, { name: `Sheet${tables.length + 1}`, columns: ['A', 'B'], rows: [['', '']] }]); setTab(tables.length) }} aria-label="Add sheet"><Plus className="h-4 w-4" /></Button>
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save workbook
        </Button>
      </div>
      {t && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
          <div className="flex items-center gap-2">
            <Input value={t.name} onChange={(e) => patch((x) => ({ ...x, name: e.target.value.slice(0, 28) }))} className="h-8 w-48 text-sm" aria-label="Sheet name" />
            <Button size="sm" variant="outline" onClick={() => patch((x) => ({ ...x, rows: [...x.rows, x.columns.map(() => '')] }))}>Add row</Button>
            <Button size="sm" variant="outline" onClick={() => patch((x) => ({ ...x, columns: [...x.columns, `Column ${x.columns.length + 1}`], rows: x.rows.map((r) => [...r, '']) }))}>Add column</Button>
            <span className="text-xs text-muted-foreground">Totals, averages, summaries and charts are rebuilt on save.</span>
          </div>
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-8" />
                {t.columns.map((c, j) => (
                  <th key={j} className="min-w-[120px] border bg-muted p-0">
                    <div className="flex items-center">
                      <input value={c} onChange={(e) => patch((x) => ({ ...x, columns: x.columns.map((cc, k) => (k === j ? e.target.value : cc)) }))} className="w-full bg-transparent px-2 py-1.5 font-medium outline-none" aria-label={`Column ${j + 1} name`} />
                      <button type="button" onClick={() => patch((x) => ({ ...x, columns: x.columns.filter((_, k) => k !== j), rows: x.rows.map((r) => r.filter((_, k) => k !== j)) }))} className="px-1 text-muted-foreground hover:text-destructive" aria-label="Delete column"><X className="h-3 w-3" /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r}>
                  <td className="text-center">
                    <button type="button" onClick={() => patch((x) => ({ ...x, rows: x.rows.filter((_, k) => k !== r) }))} className="text-muted-foreground hover:text-destructive" aria-label="Delete row"><X className="h-3 w-3" /></button>
                  </td>
                  {t.columns.map((_, c) => (
                    <td key={c} className="border p-0">
                      <input value={row[c] ?? ''} onChange={(e) => cell(r, c, e.target.value)} className={cn('w-full bg-transparent px-2 py-1 outline-none focus:bg-muted/60', typeof row[c] === 'number' && 'text-right tabular-nums')} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- pdf pages */

function PdfPages({ payload, onSaved }: { payload: EditorPayload; onSaved: (issues: string[]) => void }) {
  const total = payload.pages ?? 0
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: total }, (_, i) => i))
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    ;(async () => {
      for (let i = 0; i < total; i++) {
        const u = await editorApi.pageImage(payload.file.id, i, payload.file.version ?? 1)
        urls.push(u)
        if (!cancelled) setThumbs((t) => ({ ...t, [i]: u }))
      }
    })()
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [payload.file.id, payload.file.version, total])
  const move = (k: number, dir: -1 | 1) => {
    const j = k + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[k], next[j]] = [next[j], next[k]]
    setOrder(next)
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await editorApi.reorderPages(payload.file.id, order)
      onSaved(r.audit_issues)
    } catch {
      toast.error('Could not save the page order')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        {order.length} of {total} pages · reorder or remove pages, then save
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || order.length === 0}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save pages
        </Button>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto p-4 md:grid-cols-3 xl:grid-cols-4">
        {order.map((p, k) => (
          <div key={`${p}-${k}`} className="flex flex-col gap-1.5">
            <div className="overflow-hidden rounded-md border bg-white">
              {thumbs[p] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[p]} alt={`Page ${p + 1}`} className="w-full" />
              ) : (
                <div className="flex aspect-[1/1.41] items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Page {k + 1}{p !== k ? ` (was ${p + 1})` : ''}</span>
              <span className="flex">
                <button type="button" onClick={() => move(k, -1)} className="p-1 hover:text-foreground" aria-label="Move earlier"><ArrowLeft className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(k, 1)} className="p-1 hover:text-foreground" aria-label="Move later"><ArrowRight className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => setOrder(order.filter((_, i) => i !== k))} className="p-1 hover:text-destructive" aria-label="Remove page"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- text editor */

function TextEditor({ payload, onSaved }: { payload: EditorPayload; onSaved: (issues: string[]) => void }) {
  const [text, setText] = useState(payload.text ?? '')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const r = await editorApi.saveText(payload.file.id, text)
      onSaved(r.audit_issues)
    } catch {
      toast.error('Could not save the file')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center border-b px-3 py-2">
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-full resize-none border-r bg-transparent p-4 font-mono text-sm outline-none" aria-label="File text" />
        <div className="overflow-y-auto p-4">
          {payload.file.format === 'md' ? <MarkdownRenderer>{text}</MarkdownRenderer> : <pre className="whitespace-pre-wrap text-sm">{text}</pre>}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- preview pane */

function Preview({ payload }: { payload: EditorPayload }) {
  const f = payload.file
  const previewable = ['pdf', 'svg', 'html'].includes(f.format)
  const url = useBlobUrl(f.id, f.version, previewable)
  if (!previewable) return null
  if (!url) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (f.format === 'svg') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={f.filename} className="mx-auto max-w-full" />
  }
  return <iframe src={url} title={f.filename} className="h-full min-h-[70vh] w-full rounded-md border bg-white" sandbox={f.format === 'html' ? '' : undefined} />
}

/* ---------------------------------------------------------------- host */

type Tab = 'edit' | 'preview' | 'pages'

export function FilePanelHost() {
  const { fileId, fullscreen, close, toggleFullscreen } = useFilePanel()
  const qc = useQueryClient()
  const [payload, setPayload] = useState<EditorPayload | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('edit')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const p = await editorApi.open(id)
      setPayload(p)
      setIssues(p.file.audit_issues ?? [])
    } catch {
      toast.error('The file could not be opened')
      close()
    } finally {
      setLoading(false)
    }
  }, [close])

  useEffect(() => {
    if (fileId) {
      setTab('edit')
      load(fileId)
    } else {
      setPayload(null)
    }
  }, [fileId, load])

  const onSaved = (newIssues: string[]) => {
    setIssues(newIssues)
    toast.success(newIssues.length ? `Saved with ${newIssues.length} audit issue(s)` : 'Saved · audit found 0 issues')
    qc.invalidateQueries({ queryKey: ['studio-files'] })
    qc.invalidateQueries({ queryKey: ['thoth-files'] })
    if (fileId) load(fileId)
  }

  const tabs = useMemo<Tab[]>(() => {
    if (!payload) return []
    const t: Tab[] = []
    if (payload.mode !== 'readonly' && payload.mode !== 'pdf') t.push('edit')
    if (['pdf', 'svg', 'html'].includes(payload.file.format)) t.push('preview')
    if (payload.pdf_tools) t.push('pages')
    return t
  }, [payload])

  useEffect(() => {
    if (tabs.length && !tabs.includes(tab)) setTab(tabs[0])
  }, [tabs, tab])

  if (!fileId) return null
  const f = payload?.file

  return (
    <div className={cn('fixed z-50 flex flex-col border-l bg-background shadow-[var(--shadow-overlay)]', fullscreen ? 'inset-0' : 'inset-y-0 right-0 w-[min(1040px,78vw)]')}>
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        {f && <FileTypeIcon filetype={f.format} size={28} variant="color" />}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{f?.filename ?? 'Opening'}</span>
          {f && <span className="text-xs text-muted-foreground">Version {f.version ?? 1}{f.updated ? ` · saved ${new Date(f.updated).toLocaleTimeString()}` : ''}</span>}
        </div>
        {tabs.length > 1 && (
          <div className="ml-4 flex rounded-lg bg-muted p-0.5">
            {tabs.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1 text-xs capitalize', tab === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{t}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {f && (
            <Button size="sm" variant="outline" onClick={() => filesApi.download(f)}>
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={close} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
      </header>
      {issues.length > 0 && (
        <div className="flex items-start gap-2 border-b bg-muted/50 px-4 py-2 text-xs">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Audit: {issues.join('; ')}</span>
        </div>
      )}
      {loading || !payload ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : tab === 'preview' ? (
        <div className="flex min-h-0 flex-1 overflow-auto p-4"><Preview payload={payload} /></div>
      ) : tab === 'pages' ? (
        <PdfPages key={`${payload.file.id}-${payload.file.version}`} payload={payload} onSaved={onSaved} />
      ) : payload.mode === 'deck' ? (
        <DeckEditor key={`${payload.file.id}-${payload.file.version}`} payload={payload} onSaved={onSaved} />
      ) : payload.mode === 'document' ? (
        <DocumentEditor key={`${payload.file.id}-${payload.file.version}`} payload={payload} onSaved={onSaved} />
      ) : payload.mode === 'sheet' ? (
        <SheetEditor key={`${payload.file.id}-${payload.file.version}`} payload={payload} onSaved={onSaved} />
      ) : payload.mode === 'text' ? (
        <TextEditor key={`${payload.file.id}-${payload.file.version}`} payload={payload} onSaved={onSaved} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>This file opens read-only. Export it to edit on your device.</span>
          <span className="text-xs">This imported {payload.file.format.toUpperCase()} file has no editable source document.</span>
        </div>
      )}
    </div>
  )
}
