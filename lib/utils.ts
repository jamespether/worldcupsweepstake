import type { EntryStatus, SweepstakeEntry, TeamSummary } from '@/types/sweepstake'

export const MAX_GOALS = 21

export function getStatus(goals: number): EntryStatus {
  if (goals >= 22) return 'bust'
  if (goals >= 19) return 'danger'
  if (goals >= 15) return 'warning'
  return 'safe'
}

export function goalPct(total: number): number {
  return Math.min(Math.round((total / MAX_GOALS) * 100), 100)
}

export function sortEntries(entries: SweepstakeEntry[]): SweepstakeEntry[] {
  const active = entries
    .filter(e => e.status !== 'bust')
    .sort((a, b) => a.total - b.total)
    .map((e, i) => ({ ...e, rank: i + 1 }))
  const busted = entries
    .filter(e => e.status === 'bust')
    .sort((a, b) => b.total - a.total)
    .map(e => ({ ...e, rank: 0 }))
  return [...active, ...busted]
}

export function buildTeamSummaries(entries: SweepstakeEntry[]): TeamSummary[] {
  const map = new Map<string, TeamSummary>()
  for (const entry of entries) {
    for (const t of entry.teams) {
      if (!map.has(t.name)) {
        map.set(t.name, { name: t.name, flag: t.flag, goals: t.goals, ownerIds: [], ownerNames: [] })
      }
      const s = map.get(t.name)!
      s.goals = Math.max(s.goals, t.goals)
      if (!s.ownerIds.includes(entry.id)) {
        s.ownerIds.push(entry.id)
        s.ownerNames.push(entry.name)
      }
    }
  }
  return [...map.values()].sort((a, b) => b.goals - a.goals)
}

export function generateHeadlines(entries: SweepstakeEntry[]): string[] {
  const active = entries.filter(e => e.status !== 'bust')
  const busted = entries.filter(e => e.status === 'bust')
  const byRisk = [...active].sort((a, b) => b.total - a.total)
  const hs: string[] = []

  const top = byRisk[0]
  if (top && top.total >= 17) {
    const r = 22 - top.total
    hs.push(r <= 2
      ? `${top.name} is somehow still alive. For now.`
      : `${top.name} is ${r} goals from going home.`)
  }

  let worst: { team: string; goals: number; who: string } | null = null
  for (const e of active) {
    for (const t of e.teams) {
      if (!worst || t.goals > worst.goals) {
        worst = { team: t.name, goals: t.goals, who: e.name }
      }
    }
  }
  if (worst && worst.goals >= 4) {
    hs.push(`${worst.team} have already cost ${worst.who} ${worst.goals} goals.`)
  }

  const safest = [...active].sort((a, b) => a.total - b.total)[0]
  if (safest && safest.total <= 6) {
    hs.push(`${safest.name} hasn't broken a sweat. ${safest.total} goals. Smugly calm.`)
  } else if (safest) {
    hs.push(`${safest.name} looks comfortable on ${safest.total}. For now.`)
  }

  if (busted.length) {
    hs.push(`${busted[busted.length - 1].name} is out. ${busted[busted.length - 1].total} goals. Finished.`)
  }

  return hs.slice(0, 3)
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return 'Yesterday'
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}
