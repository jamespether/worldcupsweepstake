'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse, SweepstakeData } from '@/types/sweepstake'
import { formatKickoff, formatRelative, generateHeadlines, goalPct, statusLabel } from '@/lib/utils'

const POLL_MS = 60_000

export default function SweepstakeClient() {
  const [data, setData] = useState<SweepstakeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'table' | 'goals' | 'teams'>('overview')

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/sweepstake', { cache: 'no-store' })
      const json = (await response.json()) as ApiResponse

      if (!response.ok || !json.data) {
        setError(json.error ?? 'Failed to load sweepstake data')
        return
      }

      setData(json.data)
      setError(json.error ?? null)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const interval = window.setInterval(fetchData, POLL_MS)
    return () => window.clearInterval(interval)
  }, [fetchData])

  const headlines = useMemo(() => {
    if (!data) return []

    if (data.goalFeed.length > 0) {
      return data.goalFeed.slice(0, 3).map((event) => {
        return `${event.scoringTeam}: ${event.homeTeam} ${event.homeScore}–${event.awayScore} ${event.awayTeam}`
      })
    }

    return generateHeadlines(data.entries)
  }, [data])

  if (loading) {
    return <main className="page"><p>Loading sweepstake…</p></main>
  }

  if (!data) {
    return (
      <main className="page">
        <h1>Data unavailable</h1>
        <p>{error ?? 'Unable to load the sweepstake.'}</p>
        <button onClick={fetchData}>Try again</button>
      </main>
    )
  }

  const alive = data.entries.filter((entry) => entry.status !== 'bust').length
  const busted = data.entries.filter((entry) => entry.status === 'bust').length
  const nextMatch = data.upcomingMatches.find((match) => !match.isLive)
  const liveMatch = data.upcomingMatches.find((match) => match.isLive)
  const entryById = new Map(data.entries.map((entry) => [entry.id, entry]))
  const maxTeamGoals = Math.max(1, ...data.teamSummaries.map((team) => team.goals))

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">World Cup 2026 · Sweepstake Tracker</p>
        <h1>Stay under 21</h1>
        <p>Go over and you're out. No exceptions.</p>

        <div className="stats">
          <div><strong>{alive}</strong><span>Alive</span></div>
          <div><strong>{data.totalGoalsScored}</strong><span>Goals</span></div>
          <div><strong>{busted}</strong><span>Busted</span></div>
        </div>
      </header>

      <section className="match-strip">
        {error && <p className="warning">⚠️ {error}</p>}

        {liveMatch ? (
          <p><strong>Live:</strong> {liveMatch.homeTeam} vs {liveMatch.awayTeam}</p>
        ) : nextMatch ? (
          <p>
            <strong>Next:</strong> {nextMatch.homeTeam} vs {nextMatch.awayTeam} ·{' '}
            {nextMatch.isToday ? `Today ${formatKickoff(nextMatch.kickoff)}` : formatKickoff(nextMatch.kickoff)}
          </p>
        ) : (
          <p>No upcoming matches</p>
        )}
      </section>

      <nav className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'table' ? 'active' : ''} onClick={() => setTab('table')}>Table</button>
        <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}>Goals</button>
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>Teams</button>
      </nav>

      {tab === 'overview' && (
        <section className="section">
          <h2>Today&apos;s headlines</h2>
          {headlines.map((headline, index) => (
            <article className="card" key={headline}>
              <small>{String(index + 1).padStart(2, '0')}</small>
              <p>{headline}</p>
            </article>
          ))}

          <h2>Tournament timeline</h2>
          {data.goalFeed.length === 0 ? (
            <article className="card"><p>No goal events yet.</p></article>
          ) : (
            data.goalFeed.slice(0, 8).map((event) => (
              <article className="card" key={event.id}>
                <small>{formatRelative(event.matchTime)}</small>
                <p>{event.scoringTeam}: {event.homeTeam} {event.homeScore}–{event.awayScore} {event.awayTeam}</p>
              </article>
            ))
          )}
        </section>
      )}

      {tab === 'table' && (
        <section className="section">
          <h2>Leaderboard</h2>
          {data.entries.map((entry) => (
            <article className={`card entry ${entry.status}`} key={entry.id}>
              <div className="entry-top">
                <div>
                  <strong>{entry.rank > 0 ? `${entry.rank}. ` : ''}{entry.name}</strong>
                  <p>{entry.teams.map((team) => `${team.flag} ${team.name} (${team.goals})`).join(' · ')}</p>
                </div>
                <span>{statusLabel(entry.status)}</span>
              </div>
              <div className="bar">
                <div style={{ width: `${goalPct(entry.total)}%` }} />
              </div>
              <p>{entry.total}/21 goals · {entry.remaining} remaining</p>
            </article>
          ))}
        </section>
      )}

      {tab === 'goals' && (
        <section className="section">
          <h2>Goal feed</h2>
          {data.goalFeed.length === 0 ? (
            <article className="card"><p>No goals yet. The suffering hasn&apos;t started.</p></article>
          ) : (
            data.goalFeed.map((event) => {
              const affected = event.affectedEntryIds
                .map((id) => entryById.get(id)?.name)
                .filter(Boolean)

              return (
                <article className="card" key={event.id}>
                  <small>{formatRelative(event.matchTime)}</small>
                  <p>⚽ {event.scorerName ?? event.scoringTeam}</p>
                  <p>{event.homeTeam} {event.homeScore}–{event.awayScore} {event.awayTeam}</p>
                  {affected.length > 0 && <p>Affects: {affected.join(', ')}</p>}
                </article>
              )
            })
          )}
        </section>
      )}

      {tab === 'teams' && (
        <section className="section">
          <h2>Team totals</h2>
          {data.teamSummaries.map((team) => (
            <article className="card" key={team.name}>
              <div className="entry-top">
                <strong>{team.flag} {team.name}</strong>
                <span>{team.goals}</span>
              </div>
              <div className="bar">
                <div style={{ width: `${Math.round((team.goals / maxTeamGoals) * 100)}%` }} />
              </div>
              <p>Picked by: {team.ownerNames.join(', ')}</p>
            </article>
          ))}
        </section>
      )}

      <footer className="footer">
        Updated {formatRelative(data.lastUpdated)} · Polls every 60 seconds
      </footer>
    </main>
  )
}
