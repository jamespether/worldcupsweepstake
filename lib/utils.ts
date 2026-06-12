import type { EntryStatus, SweepstakeEntry, TeamSummary, SweepstakeData } from '@/types/sweepstake'

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

export function generateHeadlines(data: SweepstakeData): string[] {
  const { entries, goalFeed, upcomingMatches, teamSummaries } = data
  const active = entries.filter(e => e.status !== 'bust')
  const busted = entries.filter(e => e.status === 'bust')
  const byRisk = [...active].sort((a, b) => b.total - a.total)
  const bySafe = [...active].sort((a, b) => a.total - b.total)

  const candidates: string[] = []

  // 1. Tournament not started yet
  if (data.totalGoalsScored === 0) {
    const next = upcomingMatches.find(m => !m.isLive)
    if (next && next.sweepstakeTeams.length > 0) {
      candidates.push(`${next.sweepstakeTeams.join(' and ')} play soon. The damage starts then.`)
    } else if (next) {
      candidates.push(`${next.homeTeam} vs ${next.awayTeam} up next. Sweepstake teams are watching.`)
    }
    candidates.push(`Nobody has a goal to their name yet. The calm before the storm.`)
    const mostOwned = [...teamSummaries].sort((a, b) => b.ownerIds.length - a.ownerIds.length)[0]
    if (mostOwned) {
      candidates.push(`${mostOwned.name} are in ${mostOwned.ownerIds.length} entries. If they run hot, this gets messy fast.`)
    }
    return candidates.slice(0, 3)
  }

  // 2. Bust
  if (busted.length > 0) {
    const latest = busted[busted.length - 1]
    candidates.push(`${latest.name} is out. ${latest.total} goals. Gone.`)
  }

  // 3. Most at risk
  const top = byRisk[0]
  if (top) {
    const r = 22 - top.total
    if (r <= 1) {
      candidates.push(`${top.name} is one goal from being eliminated. One goal.`)
    } else if (r <= 3) {
      candidates.push(`${top.name} is ${r} goals away from going bust. Sweating buckets.`)
    } else if (top.total >= 14) {
      candidates.push(`${top.name} leads the danger table on ${top.total} goals. The gap to safety is closing.`)
    } else if (top.total >= 8) {
      candidates.push(`${top.name} sits top of the danger table on ${top.total}. Nowhere near safe.`)
    } else if (top.total > 0) {
      candidates.push(`${top.name} is leading the pack on ${top.total} goals. Early days but worth watching.`)
    }
  }

  // 4. Safest entry
  const safest = bySafe[0]
  if (safest) {
    if (safest.total === 0) {
      candidates.push(`${safest.name} is still on zero. Either very lucky or very nervous.`)
    } else if (safest.total <= 4) {
      candidates.push(`${safest.name} has only ${safest.total} goals. Absolutely breezing this.`)
    } else if (safest.total <= 8) {
      candidates.push(`${safest.name} is the calmest person here on ${safest.total} goals.`)
    }
  }

  // 5. Deadliest team
  const deadliest = teamSummaries[0]
  if (deadliest && deadliest.goals > 0) {
    const ownerList = deadliest.ownerNames.slice(0, 2).join(' and ')
    const more = deadliest.ownerNames.length > 2 ? ` (+${deadliest.ownerNames.length - 2} more)` : ''
    candidates.push(`${deadliest.name} are the most lethal in the draw — ${deadliest.goals} goals — bad news for ${ownerList}${more}.`)
  }

  // 6. Most owned team's spread
  const mostOwned = [...teamSummaries].sort((a, b) => b.ownerIds.length - a.ownerIds.length)[0]
  if (mostOwned && mostOwned.goals > 0 && mostOwned.name !== deadliest?.name) {
    candidates.push(`${mostOwned.name} are in ${mostOwned.ownerIds.length} entries and have ${mostOwned.goals} goals. Spreading the pain.`)
  }

  // 7. Recent goal feed damage
  const recent = goalFeed[0]
  if (recent) {
    const affectedNames = recent.affectedEntryIds
      .map(id => entries.find(e => e.id === id)?.name)
      .filter((n): n is string => !!n)
    const unique = [...new Set(affectedNames)]
    if (unique.length > 0) {
      const nameList = unique.slice(0, 2).join(' and ')
      const extra = unique.length > 2 ? ` and ${unique.length - 2} others` : ''
      candidates.push(`${recent.scoringTeam}'s goals have hit ${nameList}${extra} hardest in the feed.`)
    }
  }

  // 8. Gap between first and last
  if (active.length >= 2 && byRisk[0] && bySafe[0]) {
    const gap = byRisk[0].total - bySafe[0].total
    if (gap >= 8) {
      candidates.push(`${byRisk[0].name} has ${gap} more goals than ${bySafe[0].name}. The gap is enormous.`)
    } else if (gap >= 4) {
      candidates.push(`${gap} goals separate the top and bottom of the leaderboard right now.`)
    }
  }

  // 9. Live match drama
  const live = upcomingMatches.find(m => m.isLive)
  if (live && live.sweepstakeTeams.length > 0) {
    const entryCount = entries.filter(e =>
      e.teams.some(t => live.sweepstakeTeams.includes(t.name))
    ).length
    candidates.push(`${live.sweepstakeTeams.join(' and ')} are live right now. ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} affected.`)
  }

  // 10. Person with two entries — note the one in more danger
  const nameGroups = new Map<string, SweepstakeEntry[]>()
  for (const e of active) {
    const existing = nameGroups.get(e.name) ?? []
    nameGroups.set(e.name, [...existing, e])
  }
  for (const [name, group] of nameGroups) {
    if (group.length >= 2) {
      const sorted = [...group].sort((a, b) => b.total - a.total)
      if (sorted[0].total >= 10) {
        candidates.push(`${name} has two entries. One is already on ${sorted[0].total} goals. That safety net has holes.`)
      } else if (sorted[0].total > 0) {
        candidates.push(`${name} has two entries in this. One safety net, double the stress.`)
      }
      break
    }
  }

  // 11. Upcoming match with sweepstake teams
  const next = upcomingMatches.find(m => !m.isLive && m.sweepstakeTeams.length > 0)
  if (next && !live) {
    const affected = entries.filter(e =>
      e.teams.some(t => next.sweepstakeTeams.includes(t.name))
    )
    if (affected.length > 0) {
      const names = [...new Set(affected.map(e => e.name))].slice(0, 2).join(' and ')
      candidates.push(`${next.sweepstakeTeams.join(' and ')} play next. ${names} will be watching closely.`)
    }
  }

  // Deduplicate, take best 3
  const seen = new Set<string>()
  const final: string[] = []
  for (const h of candidates) {
    if (!seen.has(h) && final.length < 3) {
      seen.add(h)
      final.push(h)
    }
  }

  if (final.length === 0 && active.length > 0) {
    final.push(`${active.length} entries still alive. ${data.totalGoalsScored} goals scored so far.`)
  }

  return final
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
