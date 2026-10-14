'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@lobehub/ui/base-ui'
import { agentApi, Skill } from '@/lib/api/agent'

function SkillRow({ skill, onChange }: { skill: Skill; onChange: () => void }) {
  const toggle = async (enabled: boolean) => {
    try {
      await agentApi.updateSkill(skill.id, { enabled })
      onChange()
    } catch {
      toast.error('Could not update the skill')
    }
  }
  const remove = async () => {
    try {
      await agentApi.deleteSkill(skill.id)
      onChange()
    } catch {
      toast.error('Could not delete the skill')
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{skill.name}</span>
            {skill.builtin && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Default</span>}
          </div>
          {skill.description && <span className="text-sm text-muted-foreground">{skill.description}</span>}
        </div>
        <div className="flex items-center gap-2">
          {skill.source_url && (
            <a href={skill.source_url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Open source">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {!skill.builtin && (
            <button type="button" onClick={remove} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Delete skill">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <Switch checked={skill.enabled} onChange={(v) => toggle(v)} aria-label={`Enable ${skill.name}`} />
        </div>
      </div>
      <p className="line-clamp-3 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{skill.instructions}</p>
    </div>
  )
}

export default function SkillsPage() {
  const qc = useQueryClient()
  const { data: skills = [] } = useQuery({ queryKey: ['agent-skills'], queryFn: agentApi.listSkills })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', source_url: '', instructions: '' })
  const refresh = () => qc.invalidateQueries({ queryKey: ['agent-skills'] })

  const create = async () => {
    if (!form.name.trim() || !form.instructions.trim()) {
      toast.error('Name and instructions are required')
      return
    }
    try {
      await agentApi.createSkill(form)
      setForm({ name: '', description: '', source_url: '', instructions: '' })
      setOpen(false)
      refresh()
      toast.success('Skill added')
    } catch {
      toast.error('Could not add the skill')
    }
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
              <p className="text-sm text-muted-foreground">
                Instructions the assistant and Studio follow on every task. Enabled skills are added to the model prompt.
              </p>
            </div>
            <Button onClick={() => setOpen((v) => !v)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" /> Add skill
            </Button>
          </div>

          {open && (
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <Input placeholder="Name, e.g. Ministry style guide" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input placeholder="Short description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <Input placeholder="Source link (optional)" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
              <Textarea
                rows={6}
                placeholder="Instructions. Paste the rules from a SKILL.md or write your own. Keep it focused: the local model reads about 3,000 characters of skills in total."
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={create}>Save skill</Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {skills.map((s) => (
              <SkillRow key={s.id} skill={s} onChange={refresh} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
