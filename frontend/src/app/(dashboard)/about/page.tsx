'use client'

import { AppShell } from '@/components/layout/AppShell'
import { ThothAvatar } from '@/components/thoth/ThothAvatar'

const CAPABILITIES = [
  'Thoth, the MCIT agent: plans and runs multi-step work across notebooks, sources, files and Studio',
  'Assistant chat grounded in each notebook, with citations to the passages used',
  'Studio: presentations, PDF reports in three lengths, infographics, Excel dashboards and executive summaries',
  'In-app editors for decks, spreadsheets and Markdown, with export to your device',
  'Podcasts and speech on the MCIT text-to-speech service',
  'Local models by default; cloud models only with MCIT keys, metered on the Usage page',
]

export default function AboutPage() {
  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
          <div className="flex items-center gap-4">
            <ThothAvatar size={56} />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">MCIT AI</h1>
              <p className="text-sm text-muted-foreground">Ministry of Communications and Information Technology</p>
            </div>
          </div>

          <section className="flex flex-col gap-3 rounded-xl border bg-card p-6">
            <h2 className="font-medium">About</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              MCIT AI is the ministry&apos;s private AI workspace. Data stays in MCIT&apos;s own database, and inference runs on
              MCIT infrastructure unless an administrator connects a cloud model.
            </p>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
              {CAPABILITIES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-6 text-sm">Developed by Eng Ahmed Arfa for MCIT</section>
        </div>
      </div>
    </AppShell>
  )
}
