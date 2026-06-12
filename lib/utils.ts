import type { EntryStatus, SweepstakeEntry, TeamSummary } from '@/types/sweepstake'

export const BUST_AT = 22
export const MAX_GOALS = 21

export function getStatus(goals: number): EntryStatus {
  if (goals >= BUST_AT) return 'bust'
  if (goals >= 19) return 'danger'
  if (goals >= 15) return 'warning'
  return 'safe'
}

export function statusLabel(status: EntryStatus | string): string {
  return {
    safe: 'Safe',
    warning: 'Warning',
    danger: 'Danger',
    bust: 'Bust',
  }[status] ?? status
}

export function goalPct(total: number): number {
  return Math.min(Math.round((total / MAX_GOALS) * 100), 100)
}

export function sortEntries(entries: SweepstakeEntry[]): SweepstakeEntry[] {
  const active = entries
    .filter((entry) => entry.status !== 'bust')
    .sort((a, b) => a.total - b.total)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  const busted = entries
    .filter((entry) => entry.status === 'bust')
    .sort((a, b) => b.total - a.total)
    .map((entry) => ({ ...entry, rank: 0 }))

  return [...active, ...busted]
}

export function buildTeamSummaries(entries: SweepstakeEntry[]): TeamSummary[] {
  const map = new Map<string, TeamSummary>()

  for (const entry of entries) {
    for (const team of entry.teams) {
      if (!map.has(team.name)) {
        map.set(team.name, {
          name: team.name,
          flag: team.flag,
          goals: team.goals,
          ownerIds: [],
          ownerNames: [],
        })
      }

      const summary = map.get(team.name)!
      summary.goals = Math.max(summary.goals, team.goals)

      if (!summary.ownerIds.includes(entry.id)) {
        summary.ownerIds.push(entry.id)
        summary.ownerNames.push(entry.name)
      }
    }
  }

  return [...map.values()].sort((a, b) => b.goals - a.goals)
}

export function generateHeadlines(entries: SweepstakeEntry[]): string[] {
  const active = entries.filter((entry) => entry.status !== 'bust')
  const busted = entries.filter((entry) => entry.status === 'bust')
  const byRisk = [...active].sort((a, b) => b.total - a.total)
  const headlines: string[] = []

  const top = byRisk[0]

  if (top && top.total >= 17) {
    const remaining = BUST_AT - top.total
    headlines.push(
      remaining <= 2
        ? `${top.name} is somehow still alive. For now.`
        : `${top.name} is ${remaining} goals from going home.`
    )
  }

  let worst: { team: string; goals: number; who: string } | null = null

  for (const entry of active) {
    for (const team of entry.teams) {
      if (!worst || team.goals > worst.goals) {
        worst = { team: team.name, goals: team.goals, who: entry.name }
      }
    }
  }

  if (worst && worst.goals >= 4) {
    headlines.push(`${worst.team} have already cost ${worst.who} ${worst.goals} goals.`)
  }

  const safest = [...active].sort((a, b) => a.total - b.total)[0]

  if (safest && safest.total <= 6) {
    headlines.push(`${safest.name} hasn't broken a sweat. ${safest.total} goals. Smugly calm.`)
  } else if (safest) {
    headlines.push(`${safest.name} looks comfortable on ${safest.total}. For now.`)
  }

  if (busted.length) {
    const latest = busted[busted.length - 1]
    headlines.push(`${latest.name} is out. ${latest.total} goals. Finished.`)
  }

  return headlines.slice(0, 3)
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`

  const hours = Math.floor(mins / 60)

  if (hours < 24) return `${hours}h ago`

  return 'Yesterday'
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}
