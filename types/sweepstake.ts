export type EntryStatus = 'safe' | 'warning' | 'danger' | 'bust'

export interface RawEntry {
  name: string
  teams: string[]
}

export interface TeamGoals {
  name: string
  flag: string
  goals: number
}

export interface SweepstakeEntry {
  id: string
  name: string
  teams: TeamGoals[]
  total: number
  remaining: number
  status: EntryStatus
  rank: number
}

export interface GoalEvent {
  id: string
  minute: number
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  scoringTeam: string
  scorerName?: string
  matchTime: string
  affectedEntryIds: string[]
  isExtraTime: boolean
}

export interface UpcomingMatch {
  id: string
  homeTeam: string
  awayTeam: string
  kickoff: string
  isLive: boolean
  isToday: boolean
  sweepstakeTeams: string[]
}

export interface TeamSummary {
  name: string
  flag: string
  goals: number
  ownerIds: string[]
  ownerNames: string[]
}

export interface SweepstakeData {
  entries: SweepstakeEntry[]
  goalFeed: GoalEvent[]
  upcomingMatches: UpcomingMatch[]
  teamSummaries: TeamSummary[]
  totalGoalsScored: number
  lastUpdated: string
  nextRefreshAt: string
  tournamentStarted: boolean
  liveMatchActive: boolean
}

export interface ApiResponse {
  data: SweepstakeData | null
  cached: boolean
  cachedAt?: string
  error?: string
}

// API-Football shapes
export interface ApiFixture {
  fixture: {
    id: number
    date: string
    status: { short: string; elapsed: number | null }
  }
  teams: {
    home: { id: number; name: string }
    away: { id: number; name: string }
  }
  goals: { home: number | null; away: number | null }
  score: {
    fulltime:  { home: number | null; away: number | null }
    extratime: { home: number | null; away: number | null }
    penalty:   { home: number | null; away: number | null }
  }
  events?: ApiFixtureEvent[]
}

export interface ApiFixtureEvent {
  time: { elapsed: number; extra: number | null }
  team: { name: string }
  player: { name: string }
  type: 'Goal' | 'Card' | 'subst' | 'VAR'
  detail: string
}
