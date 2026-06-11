/**
 * Football data fetcher — API-Football v3 (api-football.com / RapidAPI)
 *
 * Env vars (set in .env.local and Vercel project settings):
 *   FOOTBALL_API_KEY        your RapidAPI key
 *   FOOTBALL_API_HOST       v3.football.api-sports.io
 *   FOOTBALL_TOURNAMENT_ID  1  (FIFA World Cup — confirm at launch)
 *   FOOTBALL_SEASON         2026
 *
 * In development with no FOOTBALL_API_KEY set, mock data is returned automatically.
 */

import type {
  ApiFixture,
  GoalEvent,
  SweepstakeData,
  SweepstakeEntry,
  TeamGoals,
  UpcomingMatch,
} from '@/types/sweepstake'
import rawEntries from '@/data/entries.json'
import { getFlag } from '@/lib/flags'
import { getStatus, sortEntries, buildTeamSummaries } from '@/lib/utils'

const API_KEY  = process.env.FOOTBALL_API_KEY ?? ''
const API_HOST = process.env.FOOTBALL_API_HOST ?? 'v3.football.api-sports.io'
const LEAGUE   = process.env.FOOTBALL_TOURNAMENT_ID ?? '1'
const SEASON   = process.env.FOOTBALL_SEASON ?? '2026'

// API-Football sometimes uses different names — normalise to our entries.json names
const NAME_MAP: Record<string, string> = {
  'USA':                          'United States',
  'United States of America':     'United States',
  'Democratic Republic of Congo': 'DR Congo',
  'The Netherlands':              'Netherlands',
  'Republic of Korea':            'South Korea',
}
function norm(name: string): string {
  return NAME_MAP[name] ?? name
}

async function apiFetch<T>(path: string): Promise<T> {
  const url = `https://${API_HOST}${path}`
  const res = await fetch(url, {
    headers: { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': API_HOST },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`API-Football ${res.status}: ${path}`)
  const json = await res.json()
  return json.response as T
}

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD'])
const LIVE     = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'LIVE'])
const UPCOMING = new Set(['NS', 'TBD'])

export async function buildSweepstakeData(): Promise<SweepstakeData> {
  const fixtures = await apiFetch<ApiFixture[]>(
    `/fixtures?league=${LEAGUE}&season=${SEASON}`
  )
  return processFixtures(fixtures)
}

export function processFixtures(fixtures: ApiFixture[]): SweepstakeData {
  const teamGoalMap = new Map<string, number>()
  const goalEvents: GoalEvent[] = []
  const upcomingMatches: UpcomingMatch[] = []
  let liveMatchActive = false
  const now = new Date()

  for (const f of fixtures) {
    const status = f.fixture.status.short
    const home   = norm(f.teams.home.name)
    const away   = norm(f.teams.away.name)
    const kickoff = new Date(f.fixture.date)

    if (UPCOMING.has(status) && kickoff > now) {
      const isToday = kickoff.toDateString() === now.toDateString()
      const sweepstakeTeams = [home, away].filter(t =>
        rawEntries.some(e => e.teams.includes(t))
      )
      upcomingMatches.push({
        id: String(f.fixture.id),
        homeTeam: home, awayTeam: away,
        kickoff: f.fixture.date,
        isLive: false, isToday, sweepstakeTeams,
      })
      continue
    }

    if (LIVE.has(status)) {
      liveMatchActive = true
      const hg = f.goals.home ?? 0
      const ag = f.goals.away ?? 0
      teamGoalMap.set(home, (teamGoalMap.get(home) ?? 0) + hg)
      teamGoalMap.set(away, (teamGoalMap.get(away) ?? 0) + ag)
      const sweepstakeTeams = [home, away].filter(t =>
        rawEntries.some(e => e.teams.includes(t))
      )
      upcomingMatches.unshift({
        id: String(f.fixture.id),
        homeTeam: home, awayTeam: away,
        kickoff: f.fixture.date,
        isLive: true, isToday: true, sweepstakeTeams,
      })
      addGoalEvents(f, home, away, goalEvents, status)
      continue
    }

    if (FINISHED.has(status)) {
      // For PEN: use AET score (excludes shootout)
      let hg: number, ag: number
      if (status === 'PEN') {
        hg = f.score.extratime.home ?? f.score.fulltime.home ?? 0
        ag = f.score.extratime.away ?? f.score.fulltime.away ?? 0
      } else {
        hg = (f.score.fulltime.home ?? 0) + (f.score.extratime.home ?? 0)
        ag = (f.score.fulltime.away ?? 0) + (f.score.extratime.away ?? 0)
      }
      teamGoalMap.set(home, (teamGoalMap.get(home) ?? 0) + hg)
      teamGoalMap.set(away, (teamGoalMap.get(away) ?? 0) + ag)
      addGoalEvents(f, home, away, goalEvents, status)
    }
  }

  // Build entries
  const rawBuilt: SweepstakeEntry[] = rawEntries.map((raw, i) => {
    const teams: TeamGoals[] = raw.teams.map(t => ({
      name: t, flag: getFlag(t), goals: teamGoalMap.get(t) ?? 0,
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

  // Wire up affected entries on goal events
  const byTeam = new Map<string, string[]>()
  for (const e of entries) {
    for (const t of e.teams) {
      if (!byTeam.has(t.name)) byTeam.set(t.name, [])
      byTeam.get(t.name)!.push(e.id)
    }
  }
  for (const ev of goalEvents) {
    ev.affectedEntryIds = byTeam.get(ev.scoringTeam) ?? []
  }

  const teamSummaries = buildTeamSummaries(entries)
  const totalGoalsScored = [...teamGoalMap.values()].reduce((s, g) => s + g, 0)

  const sorted = upcomingMatches.sort((a, b) => {
    if (a.isLive && !b.isLive) return -1
    if (!a.isLive && b.isLive) return 1
    return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  })

  const hasMatchToday = sorted.some(m => m.isToday)
  const tournamentOver =
    sorted.length === 0 &&
    fixtures.every(f => FINISHED.has(f.fixture.status.short) ||
      ['PST', 'CANC'].includes(f.fixture.status.short))

  const nextRefreshAt = liveMatchActive
    ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
    : hasMatchToday
    ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
    : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()

  return {
    entries,
    goalFeed: goalEvents
      .sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime())
      .slice(0, 20),
    upcomingMatches: sorted.slice(0, 10),
    teamSummaries,
    totalGoalsScored,
    lastUpdated: new Date().toISOString(),
    nextRefreshAt,
    tournamentStarted: fixtures.some(f => FINISHED.has(f.fixture.status.short)),
    liveMatchActive,
  }
}

function addGoalEvents(
  f: ApiFixture,
  home: string,
  away: string,
  goalEvents: GoalEvent[],
  status: string,
): void {
  if (!f.events) return
  for (const ev of f.events) {
    if (ev.type !== 'Goal') continue
    if (ev.detail === 'Missed Penalty') continue
    // Skip shootout goals (PEN status + elapsed > 120)
    if (status === 'PEN' && (ev.time.elapsed ?? 0) > 120) continue
    const scoringTeam = norm(ev.team.name)
    goalEvents.push({
      id: `${f.fixture.id}-${ev.time.elapsed}-${ev.player.name}`,
      minute: ev.time.elapsed,
      homeTeam: home, awayTeam: away,
      homeScore: f.goals.home ?? 0,
      awayScore: f.goals.away ?? 0,
      scoringTeam,
      scorerName: ev.player.name,
      matchTime: f.fixture.date,
      affectedEntryIds: [],
      isExtraTime: (ev.time.elapsed ?? 0) > 90,
    })
  }
}

// ── Mock data (used in dev when no API key is set) ─────────────────────
export function buildMockData(): SweepstakeData {
  const mockGoals: Record<string, number> = {
    'Portugal': 8, 'Brazil': 7, 'England': 6, 'Spain': 5, 'Netherlands': 5,
    'Germany': 4, 'Japan': 4, 'United States': 3, 'Mexico': 3, 'Belgium': 3,
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
  const totalGoalsScored = Object.values(mockGoals).reduce((s, g) => s + g, 0)

  const mockGoalFeed: GoalEvent[] = [
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
  ]

  const mockUpcoming: UpcomingMatch[] = [
    {
      id: 'up-1', homeTeam: 'England', awayTeam: 'Spain',
      kickoff: new Date(Date.now() + 2 * 3600_000).toISOString(),
      isLive: false, isToday: true, sweepstakeTeams: ['England', 'Spain'],
    },
    {
      id: 'up-2', homeTeam: 'Brazil', awayTeam: 'Argentina',
      kickoff: new Date(Date.now() + 26 * 3600_000).toISOString(),
      isLive: false, isToday: false, sweepstakeTeams: ['Brazil'],
    },
  ]

  return {
    entries,
    goalFeed: mockGoalFeed,
    upcomingMatches: mockUpcoming,
    teamSummaries,
    totalGoalsScored,
    lastUpdated: new Date().toISOString(),
    nextRefreshAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    tournamentStarted: true,
    liveMatchActive: false,
  }
}
