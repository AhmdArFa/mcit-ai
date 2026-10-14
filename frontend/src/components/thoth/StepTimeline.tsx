'use client'

import { useState } from 'react'
import { Check, ChevronRight, CircleAlert, Loader2, Sparkles } from 'lucide-react'

import type { RunEvent } from '@/lib/api/agent'
import { cn } from '@/lib/utils'

export interface StepView {
  id: string
  title: string
  kind: string
  status: 'running' | 'done' | 'error'
  progress: string[]
}

/** Fold the raw run events into steps. Only what the engine emitted is shown. */
export function foldSteps(events: RunEvent[]): { steps: StepView[]; skills: string[] } {
  const steps: StepView[] = []
  const byId = new Map<string, StepView>()
  const skills: string[] = []
  for (const ev of events) {
    if (ev.type === 'step') {
      const existing = byId.get(ev.id)
      if (existing) {
        existing.status = ev.status
      } else {
        const s: StepView = { id: ev.id, title: ev.title || 'Working', kind: ev.kind || 'tool', status: ev.status, progress: [] }
        byId.set(ev.id, s)
        steps.push(s)
      }
    } else if (ev.type === 'progress' && ev.step_id) {
      byId.get(ev.step_id)?.progress.push(ev.message)
    } else if (ev.type === 'skill' && !skills.includes(ev.name)) {
      skills.push(ev.name)
    }
  }
  return { steps, skills }
}

function StepRow({ step, defaultOpen }: { step: StepView; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = step.progress.length > 0
  const isOpen = open || (step.status === 'running' && expandable)
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-md py-1 text-left text-[13px]',
          expandable ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
          step.status === 'running' ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {step.status === 'running' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : step.status === 'error' ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {step.title}
          {step.status === 'running' && step.progress.length > 0 && (
            <span className="text-muted-foreground"> · {step.progress[step.progress.length - 1]}</span>
          )}
        </span>
        {expandable && (
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} />
        )}
      </button>
      {isOpen && expandable && (
        <ol className="mb-1 ml-[7px] flex flex-col gap-0.5 border-l pl-4">
          {step.progress.map((p, i) => (
            <li key={i} className="text-xs leading-relaxed text-muted-foreground">
              {p}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function StepTimeline({ events, running }: { events: RunEvent[]; running: boolean }) {
  const { steps, skills } = foldSteps(events)
  if (!steps.length && !skills.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {skills.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium">
              <Sparkles className="h-3 w-3" /> {s}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-col">
        {steps.map((s, i) => (
          <StepRow key={s.id} step={s} defaultOpen={!running && i === steps.length - 1 && s.status === 'error'} />
        ))}
      </div>
    </div>
  )
}
