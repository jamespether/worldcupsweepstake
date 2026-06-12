/**
 * Football data fetcher — football-data.org
 *
 * Env var:
 *   FOOTBALL_DATA_API_KEY
 *
 * Endpoint:
 *   https://api.football-data.org/v4/competitions/WC/matches
 */

import type {
  GoalEvent,
  SweepstakeData,
  SweepstakeEntry,
  TeamGoals,
  UpcomingMatch,
} from '@/types/sweepstake'
import rawEntries from '@/data/entries.json'
import { getFlag } from '@/lib/flags'
import { getStatus, sortEntries, buildTeamSummaries } from '@/lib/utils'

const API_KEY = process.env.FOOTBALL_DATA_API_KEY ?? ''
const API_URL = 'https://api.football-data.org/v4/competitions/WC/matches'

type FootballDataTeam = {
  id: number | null
  name: string
  shortName?: string
  tla?: string
  crest?: string
}

type FootballDataScorePart = {
  home: number | null
  away: number | null
}

type FootballDataMatch = {
  id: number
  utcDate: string
  status: string
  homeTeam: FootballDataTeam
  awayTeam: FootballDataTeam
  score: {
    winner: string | null
    duration: string
    fullTime: FootballDataScorePart
    halfTime?: FootballDataScorePart
    regularTime?: FootballDataScorePart
    extraTime?: FootballDataScorePart
    penalties?: FootballDataScorePart
  }
}

type FootballDataResponse = {
  matches: FootballDataMatch[]
}

// football-data.org sometimes uses slightly different names
const NAME_MAP: Record<string, string> = {
  USA: 'United States',
  'United States of America': 'United States',
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'The Netherlands': 'Netherlands',
  'Côte d’Ivoire': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cote d’Ivoire': 'Ivory Coast',
}

function norm(name: string): string {
  return NAME_MAP[name] ?? name
}

const FINISHED = new Set(['FINISHED'])
const LIVE = new Set(['IN_PLAY', 'PAUSED'])
const UPCOMING = new Set(['SCHEDULED', 'TIMED'])
const CANCELLED = new Set(['POSTPONED', 'SUSPENDED', 'CANCELED', 'CANCELLED'])

async function fetchWorldCupMatches(): Promise<FootballDataMatch[]> {
  if (!API_KEY) {
    throw new Error('FOOTBALL_DATA_API_KEY is not configured')
  }

  const res = await fetch(API_URL, {
    headers: {
      'X-Auth-Token': API_KEY,
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `football-data.org ${res.status}: ${body || 'Unable to fetch World Cup matches'}`
    )
  }

  const json = (await res.json()) as FootballDataResponse
  return json.matches ?? []
}

function getMatchScore(match: FootballDataMatch): { homeGoals: number; awayGoals: number } {
  const regularHome = match.score.regularTime?.home
  const regularAway = match.score.regularTime?.away
  const extraHome = match.score.extraTime?.home ?? 0
  const extraAway = match.score.extraTime?.away ?? 0

  // If regularTime exists, use regular + extra time and exclude penalties.
  if (regularHome !== undefined && regularHome !== null && regularAway !== undefined && regularAway !== null) {
    return {
      homeGoals: regularHome + extraHome,
      awayGoals: regularAway + extraAway,
    }
  }

  return {
    homeGoals: match.score.fullTime.home ?? 0,
    awayGoals: match.score.fullTime.away ?? 0,
  }
}

export async function buildSweepstakeData(): Promise<SweepstakeData> {
  const matches = await fetchWorldCupMatches()
  return processMatches(matches)
}

export function processMatches(matches: FootballDataMatch[]): SweepstakeData {
  const teamGoalMap = new Map<string, number>()
  const goalEvents: GoalEvent[] = []
  const upcomingMatches: UpcomingMatch[] = []
  let liveMatchActive = false
  const now = new Date()

  for (const match of matches) {
    const status = match.status
    const home = norm(match.homeTeam.name)
    const away = norm(match.awayTeam.name)
    const kickoff = new Date(match.utcDate)

    const sweepstakeTeams = [home, away].filter((team) =>
      rawEntries.some((entry) => entry.teams.includes(team))
    )

    if (UPCOMING.has(status) && kickoff > now) {
      upcomingMatches.push({
        id: String(match.id),
        homeTeam: home,
        awayTeam: away,
        kickoff: match.utcDate,
        isLive: false,
        isToday: kickoff.toDateString() === now.toDateString(),
        sweepstakeTeams,
      })

      continue
    }

    if (LIVE.has(status)) {
      liveMatchActive = true

      const { homeGoals, awayGoals } = getMatchScore(match)

      teamGoalMap.set(home, (teamGoalMap.get(home) ?? 0) + homeGoals)
      teamGoalMap.set(away, (teamGoalMap.get(away) ?? 0) + awayGoals)

      upcomingMatches.unshift({
        id: String(match.id),
        homeTeam: home,
        awayTeam: away,
        kickoff: match.utcDate,
        isLive: true,
        isToday: true,
        sweepstakeTeams,
      })

      addFallbackGoalEvents(match, home, away, goalEvents, homeGoals, awayGoals, true)
      continue
    }

    if (FINISHED.has(status)) {
      const { homeGoals, awayGoals } = getMatchScore(match)

      teamGoalMap.set(home, (teamGoalMap.get(home) ?? 0) + homeGoals)
      teamGoalMap.set(away, (teamGoalMap.get(away) ?? 0) + awayGoals)

      addFallbackGoalEvents(match, home, away, goalEvents, homeGoals, awayGoals, false)
    }
  }

  const rawBuilt: SweepstakeEntry[] = rawEntries.map((raw, index) => {
    const teams: TeamGoals[] = raw.teams.map((team) => ({
      name: team,
      flag: getFlag(team),
      goals: teamGoalMap.get(team) ?? 0,
    }))

    const total = teams.reduce((sum, team) => sum + team.goals, 0)

    return {
      id: `${raw.name.toLowerCase()}-${index}`,
      name: raw.name,
      teams,
      total,
      remaining: Math.max(0, 22 - total),
      status: getStatus(total),
      rank: 0,
    }
  })

  const entries = sortEntries(rawBuilt)

  const byTeam = new Map<string, string[]>()

  for (const entry of entries) {
    for (const team of entry.teams) {
      if (!byTeam.has(team.name)) {
        byTeam.set(team.name, [])
      }

      byTeam.get(team.name)!.push(entry.id)
    }
  }

  for (const event of goalEvents) {
    event.affectedEntryIds = byTeam.get(event.scoringTeam) ?? []
  }

  const teamSummaries = buildTeamSummaries(entries)
  const totalGoalsScored = [...teamGoalMap.values()].reduce((sum, goals) => sum + goals, 0)

  const sortedUpcomingMatches = upcomingMatches.sort((a, b) => {
    if (a.isLive && !b.isLive) return -1
    if (!a.isLive && b.isLive) return 1

    return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  })

  const hasMatchToday = sortedUpcomingMatches.some((match) => match.isToday)

  const tournamentStarted = matches.some(
    (match) => FINISHED.has(match.status) || LIVE.has(match.status)
  )

  const tournamentOver =
    tournamentStarted &&
    sortedUpcomingMatches.length === 0 &&
    matches.every(
      (match) => FINISHED.has(match.status) || CANCELLED.has(match.status)
    )

  const nextRefreshAt = liveMatchActive
    ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
    : hasMatchToday
      ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
      : tournamentOver
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()

  return {
    entries,
    goalFeed: goalEvents
      .sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime())
      .slice(0, 20),
    upcomingMatches: sortedUpcomingMatches.slice(0, 10),
    teamSummaries,
    totalGoalsScored,
    lastUpdated: new Date().toISOString(),
    nextRefreshAt,
    tournamentStarted,
    liveMatchActive,
  }
}

/**
 * football-data.org's matches endpoint gives us scores, but not detailed
 * per-goal scorer events. So the timeline uses a simple score-based fallback.
 */
function addFallbackGoalEvents(
  match: FootballDataMatch,
  home: string,
  away: string,
  goalEvents: GoalEvent[],
  homeGoals: number,
  awayGoals: number,
  isLive: boolean
): void {
  if (homeGoals + awayGoals === 0) return

  const scorers: Array<{ team: string; goals: number }> = [
    { team: home, goals: homeGoals },
    { team: away, goals: awayGoals },
  ]

  for (const { team, goals } of scorers) {
    if (goals === 0) continue

    goalEvents.push({
      id: `${match.id}-fallback-${team}`,
      minute: isLive ? 0 : 90,
      homeTeam: home,
      awayTeam: away,
      homeScore: homeGoals,
      awayScore: awayGoals,
      scoringTeam: team,
      scorerName: `${team} goal update`,
      matchTime: match.utcDate,
      affectedEntryIds: [],
      isExtraTime: match.score.duration === 'EXTRA_TIME',
    })
  }
}

// ── Mock data fallback ─────────────────────────────────────────────────

export function buildMockData(): SweepstakeData {
  const mockGoals: Record<string, number> = {
    Portugal: 8,
    Brazil: 7,
    Argentina: 7,
    England: 6,
    Spain: 5,
    Netherlands: 5,
    Germany: 4,
    Japan: 4,
    France: 4,
    'United States': 3,
    Mexico: 3,
    Belgium: 3,
    Uruguay: 2,
    Switzerland: 2,
    Morocco: 2,
    Austria: 2,
    Ecuador: 1,
    Senegal: 1,
    Norway: 1,
    Canada: 1,
    Croatia: 1,
    'DR Congo': 0,
    Panama: 0,
    'South Africa': 0,
    Haiti: 0,
    'New Zealand': 0,
  }

  const rawBuilt: SweepstakeEntry[] = rawEntries.map((raw, index) => {
    const teams: TeamGoals[] = raw.teams.map((team) => ({
      name: team,
      flag: getFlag(team),
      goals: mockGoals[team] ?? 0,
    }))

    const total = teams.reduce((sum, team) => sum + team.goals, 0)

    return {
      id: `${raw.name.toLowerCase()}-${index}`,
      name: raw.name,
      teams,
      total,
      remaining: Math.max(0, 22 - total),
      status: getStatus(total),
      rank: 0,
    }
  })

  const entries = sortEntries(rawBuilt)
  const teamSummaries = buildTeamSummaries(entries)
  const totalGoalsScored = Object.values(mockGoals).reduce((sum, goals) => sum + goals, 0)

  const mockGoalFeed: GoalEvent[] = [
    {
      id: 'mock-1',
      minute: 73,
      homeTeam: 'Portugal',
      awayTeam: 'Mexico',
      homeScore: 3,
      awayScore: 1,
      scoringTeam: 'Portugal',
      scorerName: 'Bruno Fernandes',
      matchTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
      affectedEntryIds: entries
        .filter((entry) => entry.teams.some((team) => team.name === 'Portugal'))
        .map((entry) => entry.id),
      isExtraTime: false,
    },
    {
      id: 'mock-2',
      minute: 45,
      homeTeam: 'Brazil',
      awayTeam: 'Canada',
      homeScore: 3,
      awayScore: 0,
      scoringTeam: 'Brazil',
      scorerName: 'Vinicius Jr',
      matchTime: new Date(Date.now() - 5 * 3600_000).toISOString(),
      affectedEntryIds: entries
        .filter((entry) => entry.teams.some((team) => team.name === 'Brazil'))
        .map((entry) => entry.id),
      isExtraTime: false,
    },
    {
      id: 'mock-3',
      minute: 67,
      homeTeam: 'England',
      awayTeam: 'Belgium',
      homeScore: 2,
      awayScore: 1,
      scoringTeam: 'England',
      scorerName: 'Bellingham',
      matchTime: new Date(Date.now() - 18 * 3600_000).toISOString(),
      affectedEntryIds: entries
        .filter((entry) => entry.teams.some((team) => team.name === 'England'))
        .map((entry) => entry.id),
      isExtraTime: false,
    },
  ]

  const mockUpcoming: UpcomingMatch[] = [
    {
      id: 'up-1',
      homeTeam: 'England',
      awayTeam: 'Spain',
      kickoff: new Date(Date.now() + 2 * 3600_000).toISOString(),
      isLive: false,
      isToday: true,
      sweepstakeTeams: ['England', 'Spain'],
    },
    {
      id: 'up-2',
      homeTeam: 'Brazil',
      awayTeam: 'Argentina',
      kickoff: new Date(Date.now() + 26 * 3600_000).toISOString(),
      isLive: false,
      isToday: false,
      sweepstakeTeams: ['Brazil', 'Argentina'],
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
