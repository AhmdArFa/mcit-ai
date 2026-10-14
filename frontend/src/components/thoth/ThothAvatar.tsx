'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export const AGENT_AVATARS = [
  'tutankhamun', 'thoth-avatar', 'akhenaten', 'cleopatra', 'hatshepsut',
  'khufu', 'nefertari', 'nefertiti', 'ramesses',
] as const

export const DEFAULT_AGENT_AVATAR = 'tutankhamun'
const STORAGE_KEY = 'mcit-ai-agent-avatar'
const CHANGE_EVENT = 'mcit-ai-agent-avatar-changed'

export function setAgentAvatar(name: string) {
  if (!AGENT_AVATARS.some((avatar) => avatar === name)) return
  localStorage.setItem(STORAGE_KEY, name)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useAgentAvatar() {
  const [avatar, setAvatar] = useState<string>(DEFAULT_AGENT_AVATAR)
  useEffect(() => {
    const update = () => {
      const saved = localStorage.getItem(STORAGE_KEY)
      setAvatar(saved && AGENT_AVATARS.some((name) => name === saved) ? saved : DEFAULT_AGENT_AVATAR)
    }
    update()
    window.addEventListener(CHANGE_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(CHANGE_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return avatar
}

export function ThothAvatar({ size = 32, className }: { size?: number; className?: string }) {
  const avatar = useAgentAvatar()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/avatars/${avatar}.webp`}
      alt={`${avatar.replace('-', ' ')} avatar`}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover', className)}
    />
  )
}
