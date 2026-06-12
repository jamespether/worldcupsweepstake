import { NextResponse } from 'next/server'
import type {
  SweepstakeData,
  SweepstakeEntry,
  TeamGoals,
  GoalEvent,
  UpcomingMatch,
  TeamSummary,
  EntryStatus,
} from '@/types/sweepstake'
import rawEntries from '@/data/entries.json'
import { getFlag } from '@/lib/flags'

// Cache for 10 minutes via Next.js ISR
export const revalidate = 600

// ── football-data.org types ──────────────────────────────────────────────────

interface FDTeam {
  id: number
  name: string
  shortName: string
  tla: string
}

interface FDScore {
  winner: string | null
  duration: string
  fullTime: { home: number | null; away: number | null }
  halfTime: { home: number | null; away: number | null }
}

interface FDMatch {
  id: number
  utcDate: string
  status: string
  homeTeam: FDTeam
  awayTeam: FDTeam
  score: FDScore
}

interface FDResponse {
  matches: FDMatch[]
}

// ── Name normalisation ────────────────────────────────────────────────────────

const NAME_MAP: Record<string, string> = {
  'USA':                           'United States',
  'United States':                 'United States',
  'Congo DR':                      'DR Congo',
  'DR Congo':                      'DR Congo',
  'Democratic Republic of Congo':  'DR Congo',
  'Korea Republic':                'South Korea',
  'Republic of Korea':             'South Korea',
  'IR Iran':                       'Iran',
  "Côte d'Ivoire":                 'Ivory Coast',
  'México':                        'Mexico',
}

function norm(name: string): string {
  return NAME_MAP[name] ?? name
}

// ── Status ────────────────────────────────────────────────────────────────────

function getStatus(goals: number): EntryStatus {
  if (goals >= 22) return 'bust'
  if (goals >= 19) return 'danger'
  if (goals >= 15) return 'warning'
  return 'safe'
}

function sortEntries(entries: SweepstakeEntry[]): SweepstakeEntry[] {
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

function buildTeamSummaries(entries: SweepstakeEntry[]): TeamSummary[] {
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

// ── Goal counting — never includes shootout goals ────────────────────────────

function countGoals(match: FDMatch): { home: number; away: number } {
  const s = match.status
  if (s !== 'FINISHED' && s !== 'IN_PLAY' && s !== 'PAUSED') {
    return { home: 0, away: 0 }
  }
  // FD fullTime already excludes shootout — it's the score at end of normal/extra time
  return {
    home: match.score.fullTime.home ?? 0,
    away: match.score.fullTime.away ?? 0,
  }
}

// ── Main data builder ─────────────────────────────────────────────────────────

async function fetchAndBuild(): Promise<SweepstakeData> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY ?? ''
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': apiKey },
    next: { revalidate: 600 },
  })
  if (!res.ok) {
    throw new Error(`football-data.org ${res.status}: ${res.statusText}`)
  }
  const json: FDResponse = await res.json()
  return processMatches(json.matches)
}

function processMatches(matches: FDMatch[]): SweepstakeData {
  const teamGoalMap = new Map<string, number>()
  const goalFeed: GoalEvent[] = []
  const upcomingMatches: UpcomingMatch[] = []
  let liveMatchActive = false
  const now = new Date()

  const LIVE     = new Set(['IN_PLAY', 'PAUSED'])
  const FINISHED = new Set(['FINISHED'])

  for (const match of matches) {
    const home   = norm(match.homeTeam.name)
    const away   = norm(match.awayTeam.name)
    const kickoff = new Date(match.utcDate)
    const status  = match.status
    const isLive     = LIVE.has(status)
    const isFinished = FINISHED.has(status)
    const isScheduled = !isLive && !isFinished

    if (isLive) liveMatchActive = true

    const { home: hg, away: ag } = countGoals(match)

    // ── Accumulate goals for leaderboard ──────────────────────────────────
    // Only touches teamGoalMap — never touched again below.
    if (isFinished || isLive) {
      teamGoalMap.set(home, (teamGoalMap.get(home) ?? 0) + hg)
      teamGoalMap.set(away, (teamGoalMap.get(away) ?? 0) + ag)
    }

    // ── Upcoming matches ──────────────────────────────────────────────────
    if (isScheduled && kickoff > now) {
      const sweepstakeTeams = [home, away].filter(t =>
        rawEntries.some(e => e.teams.includes(t))
      )
      upcomingMatches.push({
        id: String(match.id),
        homeTeam: home, awayTeam: away,
        kickoff: match.utcDate,
        isLive: false,
        isToday: kickoff.toDateString() === now.toDateString(),
        sweepstakeTeams,
      })
    }

    // ── Live match banner ─────────────────────────────────────────────────
    if (isLive) {
      const sweepstakeTeams = [home, away].filter(t =>
        rawEntries.some(e => e.teams.includes(t))
      )
      upcomingMatches.unshift({
        id: String(match.id),
        homeTeam: home, awayTeam: away,
        kickoff: match.utcDate,
        isLive: true, isToday: true, sweepstakeTeams,
      })
    }

    // ── Goal feed ─────────────────────────────────────────────────────────
    // Emit one summary GoalEvent per scoring team, per match.
    // This is always derived from score fields (FD free tier has no event data).
    // Separate from teamGoalMap — no double-counting possible.
    if ((isFinished || isLive) && hg + ag > 0) {
      const isAet = match.score.duration === 'EXTRA_TIME' ||
                    match.score.duration === 'PENALTY_SHOOTOUT'

      const scorers = [
        { team: home, goals: hg },
        { team: away, goals: ag },
      ]

      for (const { team, goals } of scorers) {
        if (goals === 0) continue
        // Only emit feed items for teams that appear in the sweepstake
        if (!rawEntries.some(e => e.teams.includes(team))) continue

        goalFeed.push({
          id: `${match.id}-${team}`,
          minute: isAet ? 120 : (isLive ? 0 : 90),
          homeTeam: home,
          awayTeam: away,
          homeScore: hg,
          awayScore: ag,
          scoringTeam: team,
          matchTime: match.utcDate,
          affectedEntryIds: [], // wired up below after entries are built
          isExtraTime: isAet,
        })
      }
    }
  }

  // ── Build sweepstake entries ──────────────────────────────────────────────
  const rawBuilt: SweepstakeEntry[] = rawEntries.map((raw, i) => {
    const teams: TeamGoals[] = raw.teams.map(t => ({
      name: t,
      flag: getFlag(t),
      goals: teamGoalMap.get(t) ?? 0,
    }))
    const total = teams.reduce((s, t) => s + t.goals, 0)
    return {
      id: `${raw.name.toLowerCase()}-${i}`,
      name: raw.name,
      teams,
      total,
      remaining: Math.max(0, 22 - total),
      status: getStatus(total),
      rank: 0,
    }
  })

  const entries = sortEntries(rawBuilt)

  // ── Wire up affectedEntryIds ──────────────────────────────────────────────
  const byTeam = new Map<string, string[]>()
  for (const e of entries) {
    for (const t of e.teams) {
      if (!byTeam.has(t.name)) byTeam.set(t.name, [])
      byTeam.get(t.name)!.push(e.id)
    }
  }
  for (const ev of goalFeed) {
    ev.affectedEntryIds = byTeam.get(ev.scoringTeam) ?? []
  }

  const teamSummaries = buildTeamSummaries(entries)
  const totalGoalsScored = [...teamGoalMap.values()].reduce((s, g) => s + g, 0)

  const sortedUpcoming = upcomingMatches
    .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
    .sort((a, b) => {
      if (a.isLive && !b.isLive) return -1
      if (!a.isLive && b.isLive) return 1
      return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    })

  const sortedFeed = goalFeed
    .sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime())
    .slice(0, 20)

  const tournamentStarted = matches.some(m =>
    FINISHED.has(m.status) || LIVE.has(m.status)
  )

  const nextRefreshAt = liveMatchActive
    ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
    : sortedUpcoming.some(m => m.isToday)
    ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
    : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()

  return {
    entries,
    goalFeed: sortedFeed,
    upcomingMatches: sortedUpcoming.slice(0, 10),
    teamSummaries,
    totalGoalsScored,
    lastUpdated: new Date().toISOString(),
    nextRefreshAt,
    tournamentStarted,
    liveMatchActive,
  }
}

// ── Mock data for local dev (no API key) ─────────────────────────────────────

function buildMockData(): SweepstakeData {
  const mockGoals: Record<string, number> = {
    'Portugal': 8, 'Brazil': 7, 'England': 6, 'Spain': 5,
    'Netherlands': 5, 'Germany': 4, 'Japan': 4,
    'United States': 3, 'Mexico': 3, 'Belgium': 3,
    'Uruguay': 2, 'Switzerland': 2, 'Morocco': 2, 'Austria': 2,
    'Ecuador': 1, 'Senegal': 1, 'Norway': 1, 'Canada': 1, 'Croatia': 1,
    'DR Congo': 0, 'Panama': 0, 'South Africa': 0, 'Haiti': 0, 'New Zealand': 0,
  }

  const rawBuilt: SweepstakeEntry[] = rawEntries.map((raw, i) => {
    const teams: TeamGoals[] = raw.teams.map(t => ({
      name: t, flag: getFlag(t), goals: mockGoals[t] ?? 0,
    }))
    const total = teams.reduce((s, t) => s + t.goals, 0)
    return {
      id: `${raw.name.toLowerCase()}-${i}`,
      name: raw.name, teams, total,
      remaining: Math.max(0, 22 - total),
      status: getStatus(total),
      rank: 0,
    }
  })

  const entries = sortEntries(rawBuilt)
  const teamSummaries = buildTeamSummaries(entries)

  const mockFeed: GoalEvent[] = [
    {
      id: 'mock-1', minute: 73,
      homeTeam: 'Portugal', awayTeam: 'Mexico', homeScore: 3, awayScore: 1,
      scoringTeam: 'Portugal', scorerName: 'Bruno Fernandes',
      matchTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
      affectedEntryIds: entries.filter(e => e.teams.some(t => t.name === 'Portugal')).map(e => e.id),
      isExtraTime: false,
    },
    {
      id: 'mock-2', minute: 45,
      homeTeam: 'Brazil', awayTeam: 'Canada', homeScore: 3, awayScore: 0,
      scoringTeam: 'Brazil', scorerName: 'Vinicius Jr',
      matchTime: new Date(Date.now() - 5 * 3600_000).toISOString(),
      affectedEntryIds: entries.filter(e => e.teams.some(t => t.name === 'Brazil')).map(e => e.id),
      isExtraTime: false,
    },
    {
      id: 'mock-3', minute: 67,
      homeTeam: 'England', awayTeam: 'Belgium', homeScore: 2, awayScore: 1,
      scoringTeam: 'England', scorerName: 'Bellingham',
      matchTime: new Date(Date.now() - 18 * 3600_000).toISOString(),
      affectedEntryIds: entries.filter(e => e.teams.some(t => t.name === 'England')).map(e => e.id),
      isExtraTime: false,
    },
    {
      id: 'mock-4', minute: 55,
      homeTeam: 'England', awayTeam: 'Belgium', homeScore: 2, awayScore: 1,
      scoringTeam: 'Belgium', scorerName: 'De Bruyne',
      matchTime: new Date(Date.now() - 18 * 3600_000).toISOString(),
      affectedEntryIds: entries.filter(e => e.teams.some(t => t.name === 'Belgium')).map(e => e.id),
      isExtraTime: false,
    },
  ]

  return {
    entries,
    goalFeed: mockFeed,
    upcomingMatches: [
      {
        id: 'up-1', homeTeam: 'England', awayTeam: 'Spain',
        kickoff: new Date(Date.now() + 2 * 3600_000).toISOString(),
        isLive: false, isToday: true, sweepstakeTeams: ['England', 'Spain'],
      },
    ],
    teamSummaries,
    totalGoalsScored: Object.values(mockGoals).reduce((s, g) => s + g, 0),
    lastUpdated: new Date().toISOString(),
    nextRefreshAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    tournamentStarted: true,
    liveMatchActive: false,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const hasKey = !!process.env.FOOTBALL_DATA_API_KEY
  const isDev  = process.env.NODE_ENV === 'development'

  try {
    const data = !hasKey && isDev ? buildMockData() : await fetchAndBuild()
    return NextResponse.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[/api/sweepstake]', message)
    return NextResponse.json(
      { data: null, error: `Could not load match data: ${message}` },
      { status: 503 }
    )
  }
}
