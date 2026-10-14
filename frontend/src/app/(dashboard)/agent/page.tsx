'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Markdown } from '@lobehub/ui'
import {
  BookOpen,
  CircleAlert,
  FileText,
  Loader2,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/layout/AppShell'
import { FileCard } from '@/components/files/FileCard'
import { StepTimeline } from '@/components/thoth/StepTimeline'
import { AGENT_AVATARS, setAgentAvatar, ThothAvatar, useAgentAvatar } from '@/components/thoth/ThothAvatar'
import {
  agentApi,
  AgentFile,
  Attachment,
  followRun,
  formatBytes,
  formatTokens,
  RunEvent,
  RunUsage,
} from '@/lib/api/agent'
import { sourcesApi } from '@/lib/api/sources'
import { useModels, useModelDefaults } from '@/lib/hooks/use-models'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  events?: RunEvent[]
  files?: AgentFile[]
  attachments?: { source_id: string; filename: string }[]
  usage?: RunUsage
  model?: string
  error?: string
  pending?: boolean
  time: number
}

interface Topic {
  id: string
  title: string
  notebookId?: string
  modelId?: string
  thinking?: string
  skillIds?: string[]
  messages: Message[]
  updated: number
}

interface PendingAttachment extends Partial<Attachment> {
  key: string
  name: string
  size: number
  state: 'uploading' | 'processing' | 'ready' | 'failed'
  error?: string
}

const STORAGE_KEY = 'mcit-ai-thoth-topics'
const ANY = '__any__'
const uid = () => Math.random().toString(36).slice(2, 10)

function loadTopics(): Topic[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export default function ThothPage() {
  const queryClient = useQueryClient()
  const [topics, setTopics] = useState<Topic[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [liveUsage, setLiveUsage] = useState<RunUsage | null>(null)
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<'skills' | 'documents' | 'run' | 'profile'>('skills')
  const [topicMenuOpen, setTopicMenuOpen] = useState(false)
  const selectedAvatar = useAgentAvatar()
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: notebooks } = useNotebooks(false)
  const { data: models } = useModels()
  const { data: defaults } = useModelDefaults()
  const { data: skills = [] } = useQuery({ queryKey: ['agent-skills'], queryFn: agentApi.listSkills })

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setPanelOpen(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const languageModels = useMemo(() => (models ?? []).filter((m) => m.type === 'language'), [models])

  useEffect(() => {
    const t = loadTopics()
    setTopics(t)
    const nb = new URLSearchParams(window.location.search).get('notebook')
    if (nb) {
      const fresh: Topic = { id: uid(), title: 'New topic', notebookId: nb, messages: [], updated: Date.now() }
      setTopics([fresh, ...t])
      setActiveId(fresh.id)
    } else if (t[0]) setActiveId(t[0].id)
  }, [])

  useEffect(() => {
    if (topics.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(topics.slice(0, 60)))
  }, [topics])

  const active = useMemo(() => topics.find((t) => t.id === activeId) ?? null, [topics, activeId])
  const modelId = active?.modelId || defaults?.default_tools_model || defaults?.default_chat_model || ''
  const model = languageModels.find((m) => m.id === modelId)
  const { data: caps } = useQuery({
    queryKey: ['model-caps', modelId],
    queryFn: () => agentApi.capabilities(modelId),
    enabled: !!modelId,
    staleTime: 5 * 60_000,
  })
  const selectedSkillIds = active?.skillIds ?? skills.filter((s) => s.enabled).map((s) => s.id)
  const thinking = caps?.reasoning ? active?.thinking || 'medium' : 'off'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [active?.messages])

  const ensureTopic = (): Topic => {
    if (active) return active
    const t: Topic = { id: uid(), title: 'New topic', messages: [], updated: Date.now() }
    setTopics((all) => [t, ...all])
    setActiveId(t.id)
    return t
  }
  const patchTopic = useCallback((id: string, fn: (t: Topic) => Topic) => {
    setTopics((all) => all.map((t) => (t.id === id ? { ...fn(t), updated: Date.now() } : t)))
  }, [])
  useEffect(() => {
    if (notebooks && active?.notebookId && !notebooks.some((n) => n.id === active.notebookId)) {
      patchTopic(active.id, (topic) => ({ ...topic, notebookId: undefined }))
    }
  }, [notebooks, active?.id, active?.notebookId, patchTopic])
  const patchLast = useCallback(
    (id: string, fn: (m: Message) => Message) =>
      patchTopic(id, (t) => ({ ...t, messages: t.messages.map((m, i) => (i === t.messages.length - 1 ? fn(m) : m)) })),
    [patchTopic]
  )
  const setOpt = (patch: Partial<Topic>) => {
    const t = ensureTopic()
    patchTopic(t.id, (x) => ({ ...x, ...patch }))
  }

  const newTopic = () => {
    const t: Topic = { id: uid(), title: 'New topic', notebookId: active?.notebookId, modelId: active?.modelId, messages: [], updated: Date.now() }
    setTopics((all) => [t, ...all])
    setActiveId(t.id)
    setPending([])
  }
  const deleteTopic = (id: string) =>
    setTopics((all) => {
      const next = all.filter((t) => t.id !== id)
      if (!next.length) localStorage.removeItem(STORAGE_KEY)
      if (id === activeId) setActiveId(next[0]?.id ?? null)
      return next
    })

  /* ---------------- attachments ---------------- */
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const t = ensureTopic()
    for (const file of Array.from(files)) {
      const key = uid()
      setPending((p) => [...p, { key, name: file.name, size: file.size, state: 'uploading' }])
      try {
        const target = notebooks && t.notebookId && !notebooks.some((n) => n.id === t.notebookId) ? undefined : t.notebookId
        const att = await agentApi.attach(file, target)
        // A new topic without a notebook uploads into Thoth workspace. Pin the
        // conversation to it so notebook-scoped tools can read the attachment.
        if (!target) {
          patchTopic(t.id, (topic) => ({ ...topic, notebookId: att.notebook_id }))
          queryClient.invalidateQueries({ queryKey: ['notebooks'] })
        }
        setPending((p) => p.map((x) => (x.key === key ? { ...x, ...att, state: 'processing' } : x)))
        // Wait for real processing status from the source pipeline
        let finished = false
        for (let i = 0; i < 120; i++) {
          const st = await sourcesApi.status(att.source_id)
          if (st.status === 'completed') {
            setPending((p) => p.map((x) => (x.key === key ? { ...x, state: 'ready' } : x)))
            finished = true
            break
          }
          if (st.status === 'failed' || st.status === 'error') {
            setPending((p) => p.map((x) => (x.key === key ? { ...x, state: 'failed', error: 'Source processing failed. Check the source in its notebook.' } : x)))
            finished = true
            break
          }
          await new Promise((r) => setTimeout(r, 2000))
        }
        if (!finished) setPending((p) => p.map((x) => (x.key === key ? { ...x, state: 'failed', error: 'Source processing timed out. Check the worker and retry from the source page.' } : x)))
      } catch (e) {
        const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        setPending((p) => p.map((x) => (x.key === key ? { ...x, state: 'failed', error: msg || 'Upload failed' } : x)))
      }
    }
  }

  /* ---------------- send ---------------- */
  const send = async (text?: string) => {
    const value = (text ?? input).trim()
    if (!value || runId) return
    if (pending.some((p) => p.state === 'uploading' || p.state === 'processing')) {
      toast.info('Attachments are still processing')
      return
    }
    const t = ensureTopic()
    const atts = pending.filter((p) => p.state === 'ready' && p.source_id).map((p) => ({ source_id: p.source_id!, filename: p.name }))
    const history = [...t.messages.filter((m) => m.content), { role: 'user' as const, content: value }]
    patchTopic(t.id, (x) => ({
      ...x,
      title: x.messages.length ? x.title : value.slice(0, 64),
      messages: [
        ...x.messages,
        { id: uid(), role: 'user', content: value, attachments: atts, time: Date.now() },
        { id: uid(), role: 'assistant', content: '', events: [], files: [], pending: true, model: model?.name, time: Date.now() },
      ],
    }))
    setInput('')
    setPending([])
    setLiveUsage({ input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 })
    setPanelTab('run')
    try {
      const run = await agentApi.start({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        notebook_id: t.notebookId ?? null,
        model_id: modelId || null,
        thinking: caps?.reasoning ? thinking : null,
        skill_ids: selectedSkillIds,
        attachments: atts,
      })
      setRunId(run.id)
      const final = await followRun(run.id, (evs, snap) => {
        setLiveUsage(snap.usage)
        patchLast(t.id, (m) => {
          const files = [...(m.files ?? [])]
          let content = m.content
          let error = m.error
          for (const ev of evs) {
            if (ev.type === 'file' && !files.some((f) => f.id === ev.file.id)) files.push(ev.file)
            if (ev.type === 'message') content = ev.content
            if (ev.type === 'error') error = ev.message
          }
          return { ...m, events: [...(m.events ?? []), ...evs].slice(-400), files, content, error }
        })
      })
      patchLast(t.id, (m) => ({ ...m, usage: final.usage }))
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      patchLast(t.id, (m) => ({ ...m, error: msg || 'Thoth could not be reached.' }))
    } finally {
      patchLast(t.id, (m) => ({ ...m, pending: false }))
      setRunId(null)
    }
  }

  const stop = async () => {
    if (runId) await agentApi.cancel(runId)
  }

  const topicFiles = useMemo(() => (active?.messages ?? []).flatMap((m) => m.files ?? []), [active])
  const topicAttachments = useMemo(() => (active?.messages ?? []).flatMap((m) => m.attachments ?? []), [active])
  const shownTopics = topics.filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()))
  const notebookName = notebooks?.find((n) => n.id === active?.notebookId)?.name

  return (
    <AppShell hideSidebar>
      <div className="flex min-h-0 flex-1">
        {/* ---------------- left: topics ---------------- */}
        <aside className={cn('w-64 shrink-0 flex-col border-r bg-background', topicMenuOpen ? 'fixed inset-y-0 left-0 z-50 flex md:static' : 'hidden md:flex')}>
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
            <button type="button" onClick={() => { setPanelTab('profile'); setPanelOpen(true); setTopicMenuOpen(false) }} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label="Agent profile">
              <ThothAvatar size={40} />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">Thoth</span>
                <span className="text-[11px] text-muted-foreground">MCIT AI agent</span>
              </span>
            </button>
            <button type="button" onClick={() => setTopicMenuOpen(false)} className="md:hidden" aria-label="Close topics"><X className="h-4 w-4" /></button>
          </div>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-3 text-xs text-muted-foreground" aria-label="Workspace navigation">
            <Link href="/notebooks" className="hover:text-foreground">Notebooks</Link>
            <Link href="/files" className="hover:text-foreground">Files</Link>
            <Link href="/usage" className="hover:text-foreground">Usage</Link>
            <Link href="/settings/models" className="hover:text-foreground">Models</Link>
          </nav>
          <div className="flex flex-col gap-2 p-3">
            <button type="button" onClick={newTopic} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
              <Plus className="h-4 w-4" /> Start new topic
            </button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search topics" className="h-8 w-full rounded-lg border bg-transparent pl-8 pr-2 text-sm outline-none focus:border-foreground/30" />
            </div>
          </div>
          <div className="px-4 pb-1 text-[11px] font-medium text-muted-foreground">Topics</div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {shownTopics.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><BookOpen className="h-3.5 w-3.5" /> No topics</div>
            )}
            {shownTopics.map((t) => (
              <div key={t.id} className={cn('group flex items-center gap-1 rounded-lg px-3 py-2 text-sm', t.id === activeId ? 'bg-muted font-medium' : 'text-foreground/80 hover:bg-muted/60')}>
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => { setActiveId(t.id); setTopicMenuOpen(false) }}>{t.title}</button>
                <button type="button" aria-label="Delete topic" onClick={() => deleteTopic(t.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </aside>

        {/* ---------------- center: conversation ---------------- */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <button type="button" className="md:hidden" onClick={() => setTopicMenuOpen(true)} aria-label="Open topics"><Menu className="h-4 w-4" /></button>
              <ThothAvatar size={28} />
              <span className="truncate font-medium">{active?.messages.length ? active.title : 'Thoth'}</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={active?.notebookId ?? ANY}
                onChange={(e) => setOpt({ notebookId: e.target.value === ANY ? undefined : e.target.value })}
                disabled={!!runId || pending.some((p) => p.state !== 'failed')}
                className="h-8 max-w-[220px] rounded-lg border bg-transparent px-2 text-sm"
                aria-label="Notebook"
              >
                <option value={ANY}>All notebooks</option>
                {notebooks?.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              <button type="button" onClick={() => setPanelOpen((v) => !v)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Toggle context panel">
                {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 py-6">
              {!active?.messages.length ? (
                <div className="flex flex-col items-center gap-3 pt-[14vh] text-center">
                  <ThothAvatar size={96} />
                  <h1 className="text-2xl font-semibold tracking-tight">Thoth</h1>
                  <p className="text-sm text-muted-foreground">
                    {notebookName ? `Working in ${notebookName}. What do you need?` : 'What should we work on today?'}
                  </p>
                </div>
              ) : (
                active.messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="flex flex-col items-end gap-1.5">
                      {!!m.attachments?.length && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {m.attachments.map((a) => (
                            <span key={a.source_id} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"><Paperclip className="h-3 w-3" />{a.filename}</span>
                          ))}
                        </div>
                      )}
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2.5 text-sm">{m.content}</div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      <ThothAvatar size={40} className="shrink-0" />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <StepTimeline events={m.events ?? []} running={!!m.pending} />
                        {m.pending && !(m.events ?? []).length && (
                          <span className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting</span>
                        )}
                        {m.content && (
                          <div className="text-sm leading-relaxed">
                            <Markdown variant="chat">{m.content}</Markdown>
                          </div>
                        )}
                        {!!m.files?.length && (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {m.files.map((f) => <FileCard key={f.id} file={f} />)}
                          </div>
                        )}
                        {m.error && (
                          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive">
                            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {m.error}
                          </div>
                        )}
                        {m.usage && !m.pending && (
                          <span className="text-[11px] text-muted-foreground">
                            {m.model ? `${m.model} · ` : ''}{formatTokens(m.usage.input_tokens + m.usage.output_tokens)} tokens
                            {m.usage.reasoning_tokens ? ` (${formatTokens(m.usage.reasoning_tokens)} reasoning)` : ''} · {m.usage.calls} model call{m.usage.calls === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </div>

          {/* ---------------- composer ---------------- */}
          <div className="mx-auto w-full max-w-3xl px-6 pb-5">
            <div className="rounded-2xl border bg-card focus-within:border-foreground/25">
              {(pending.length > 0 || selectedSkillIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                  {selectedSkillIds.map((id) => {
                    const s = skills.find((x) => x.id === id)
                    return s ? (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">
                        <Sparkles className="h-3 w-3" /> {s.name}
                      </span>
                    ) : null
                  })}
                  {pending.map((p) => (
                    <span key={p.key} className={cn('inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs', p.state === 'failed' && 'border-destructive/40 text-destructive')}>
                      {p.state === 'uploading' || p.state === 'processing' ? <Loader2 className="h-3 w-3 animate-spin" /> : p.state === 'failed' ? <CircleAlert className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      {p.name} <span className="text-muted-foreground">{p.state === 'ready' ? `Ready · ${formatBytes(p.size)}` : p.state}</span>
                      <button type="button" onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))} aria-label={`Remove ${p.name}`}><X className="h-3 w-3" /></button>
                      {p.error && <span role="alert" className="basis-full text-[11px] leading-relaxed">{p.error}</span>}
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={2}
                placeholder={notebookName ? `Message Thoth about ${notebookName}` : 'Message Thoth'}
                className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none"
              />
              <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
                <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Attach files">
                  <Plus className="h-4 w-4" />
                </button>
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {caps?.context_window ? (
                    <span className="hidden text-[11px] text-muted-foreground sm:inline" title={`Reported by ${caps.source}`}>
                      {formatTokens(caps.context_window)} active context
                    </span>
                  ) : null}
                  <select value={modelId} onChange={(e) => setOpt({ modelId: e.target.value })} className="h-8 max-w-[125px] rounded-lg bg-transparent px-2 text-xs hover:bg-muted sm:max-w-[190px]" aria-label="Model">
                    {languageModels.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}
                  </select>
                  <select
                    value={thinking}
                    onChange={(e) => setOpt({ thinking: e.target.value })}
                    disabled={!caps?.reasoning}
                    title={caps?.reasoning ? 'Reasoning effort' : `${caps?.name ?? 'This model'} does not support adjustable reasoning`}
                    className="h-8 max-w-[110px] rounded-lg bg-transparent px-2 text-xs hover:bg-muted disabled:opacity-50 sm:max-w-none"
                    aria-label="Thinking level"
                  >
                    {caps?.reasoning ? (
                      <>
                        <option value="low">Thinking: Low</option>
                        <option value="medium">Thinking: Medium</option>
                        <option value="high">Thinking: High</option>
                      </>
                    ) : (
                      <option value="off">Thinking: not supported</option>
                    )}
                  </select>
                  {runId ? (
                    <button type="button" onClick={stop} className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background" aria-label="Stop"><Square className="h-3.5 w-3.5" /></button>
                  ) : (
                    <button type="button" onClick={() => send()} disabled={!input.trim()} className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background disabled:opacity-30" aria-label="Send"><Send className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- right: context panel ---------------- */}
        {panelOpen && (
          <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(20rem,90vw)] flex-col border-l bg-background lg:static lg:z-auto lg:w-80 lg:shrink-0">
            <div className="flex gap-1 border-b px-3 py-2">
              {(['skills', 'documents', 'run', 'profile'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setPanelTab(tab)} className={cn('rounded-md px-3 py-1.5 text-xs capitalize', panelTab === tab ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}>{tab}</button>
              ))}
              <button type="button" onClick={() => setPanelOpen(false)} className="ml-auto lg:hidden" aria-label="Close context panel"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {panelTab === 'profile' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 rounded-lg border p-3"><ThothAvatar size={72} /><div><div className="font-semibold">Thoth</div><div className="text-xs text-muted-foreground">MCIT AI agent</div></div></div>
                  <div className="text-xs font-medium text-muted-foreground">Choose an avatar</div>
                  <div className="grid grid-cols-3 gap-2">
                    {AGENT_AVATARS.map((name) => (
                      <button key={name} type="button" onClick={() => setAgentAvatar(name)} aria-pressed={selectedAvatar === name} aria-label={`Use ${name === 'thoth-avatar' ? 'Thoth' : name} avatar`} className={cn('flex flex-col items-center gap-1 rounded-lg border p-2 hover:bg-muted', selectedAvatar === name && 'border-foreground/60 bg-muted')}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/avatars/${name}.webp`} alt="" width={48} height={48} className="rounded-full object-cover" />
                        <span className="max-w-full truncate text-[10px] capitalize">{name.replace('-', ' ')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {panelTab === 'skills' && (
                <div className="flex flex-col gap-2">
                  {skills.length === 0 && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" /> No skills</div>}
                  {skills.map((s) => {
                    const on = selectedSkillIds.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setOpt({ skillIds: on ? selectedSkillIds.filter((x) => x !== s.id) : [...selectedSkillIds, s.id] })}
                        className={cn('flex flex-col gap-0.5 rounded-lg border p-3 text-left', on ? 'border-foreground/40 bg-muted' : 'hover:bg-muted/50')}
                      >
                        <span className="flex items-center justify-between text-sm font-medium">{s.name}<span className="text-[11px] font-normal text-muted-foreground">{on ? 'On for this topic' : 'Off'}</span></span>
                        <span className="text-xs text-muted-foreground">{s.description}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {panelTab === 'documents' && (
                <div className="flex flex-col gap-2">
                  {topicFiles.length === 0 && topicAttachments.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" /> No documents</div>
                  )}
                  {topicFiles.map((f) => <FileCard key={f.id} file={f} />)}
                  {topicAttachments.map((a) => (
                    <div key={a.source_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><Paperclip className="h-3.5 w-3.5" />{a.filename}</div>
                  ))}
                </div>
              )}
              {panelTab === 'run' && (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Model</div>
                    <div className="font-medium">{caps?.name ?? model?.name ?? '—'}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">Context window</div>{caps?.context_window ? `${caps.context_window.toLocaleString()} tokens` : 'Not reported'}</div>
                      <div><div className="text-muted-foreground">Reasoning</div>{caps?.reasoning ? 'Adjustable' : 'Not supported'}</div>
                      <div><div className="text-muted-foreground">Tools</div>{caps?.tools === false ? 'No' : caps?.tools ? 'Yes' : 'Not reported'}</div>
                      <div><div className="text-muted-foreground">Vision</div>{caps?.vision ? 'Yes' : 'No'}</div>
                    </div>
                    {caps?.source && <div className="mt-2 text-[11px] text-muted-foreground">Source: {caps.source}</div>}
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {runId ? 'This run (live)' : 'Last run'}
                      {runId && <Loader2 className="h-3 w-3 animate-spin" />}
                    </div>
                    {liveUsage ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div><div className="text-muted-foreground">Input</div>{liveUsage.input_tokens.toLocaleString()}</div>
                        <div><div className="text-muted-foreground">Output</div>{liveUsage.output_tokens.toLocaleString()}</div>
                        <div><div className="text-muted-foreground">Reasoning</div>{liveUsage.reasoning_tokens.toLocaleString()}</div>
                        <div><div className="text-muted-foreground">Model calls</div>{liveUsage.calls}</div>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">No run yet</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  )
}
