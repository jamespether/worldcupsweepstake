'use client'

import { useEffect, useState, useCallback } from 'react'
import type { SweepstakeData, SweepstakeEntry, ApiResponse } from '@/types/sweepstake'
import { goalPct, generateHeadlines, formatRelative, formatKickoff } from '@/lib/utils'

const POLL_MS = 60_000

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(s: string) {
  return { safe: 'Safe', warning: 'Warning', danger: 'Danger', bust: 'Bust' }[s] ?? s
}

function GoalBar({ total, status, showMeta = true }: { total: number; status: string; showMeta?: boolean }) {
  const pct = goalPct(total)
  const colour = { safe: '#22873E', warning: '#C8860A', danger: '#C0392B', bust: '#7F1D1D' }[status] ?? '#22873E'
  return (
    <div>
      {showMeta && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          <span>{total} goals</span>
          <span>{Math.max(0, 22 - total)} remaining</span>
        </div>
      )}
      <div style={{ background: 'var(--ink3)', borderRadius: 2, overflow: 'hidden', height: 3, position: 'relative' }}>
        <div style={{ height: 3, borderRadius: 2, background: colour, width: `${pct}%`, transition: 'width .6s ease' }} />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const colour = {
    safe:    { bg: 'rgba(26,107,53,0.18)',  text: '#6EE89A', border: 'rgba(110,232,154,0.2)' },
    warning: { bg: 'rgba(200,134,10,0.15)', text: '#F5B942', border: 'rgba(245,185,66,0.2)'  },
    danger:  { bg: 'rgba(192,57,43,0.15)',  text: '#FF8A80', border: 'rgba(255,138,128,0.2)' },
    bust:    { bg: 'rgba(127,29,29,0.2)',   text: '#F87171', border: 'rgba(248,113,113,0.15)'},
  }[status] ?? { bg: 'transparent', text: '#666', border: 'transparent' }

  return (
    <span style={{
      fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em',
      padding: '2px 6px', borderRadius: 3,
      background: colour.bg, color: colour.text, border: `1px solid ${colour.border}`,
    }}>
      {statusLabel(status)}
    </span>
  )
}

function LbCard({ entry, entries }: { entry: SweepstakeEntry; entries: SweepstakeEntry[] }) {
  const isBust = entry.status === 'bust'
  return (
    <div style={{
      borderBottom: '1px solid var(--rule2)', padding: '12px 16px',
      opacity: isBust ? 0.35 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {entry.rank > 0 && (
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', width: 14 }}>
              {entry.rank}
            </span>
          )}
          <span style={{
            fontSize: 15, fontWeight: 800, letterSpacing: '-.02em',
            textTransform: 'uppercase', color: 'var(--text)',
            textDecoration: isBust ? 'line-through' : 'none',
          }}>
            {entry.name}
          </span>
          <StatusPill status={entry.status} />
        </div>
        <div style={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.03em', lineHeight: 1 }}>
          {entry.total}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dim)' }}>/21</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 9 }}>
        {entry.teams.map(t => (
          <div key={t.name} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--ink2)', border: '1px solid var(--rule)',
            borderRadius: 4, padding: '4px 8px',
            fontSize: 11, fontWeight: 600, color: 'var(--text2)',
          }}>
            <span>{t.flag}</span>{t.name}
            <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', marginLeft: 2 }}>{t.goals}</span>
          </div>
        ))}
      </div>
      <GoalBar total={entry.total} status={entry.status} />
    </div>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', marginBottom: 0 }}>
      <div style={{ width: 3, background: 'var(--pitch)', flexShrink: 0 }} />
      <div style={{
        background: 'var(--ink2)',
        borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
        padding: '8px 16px',
        fontSize: 9, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase',
        color: 'var(--text2)', flex: 1,
      }}>
        {label}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SweepstakeClient() {
  const [data, setData] = useState<SweepstakeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staleWarn, setStaleWarn] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'table' | 'goals' | 'teams' | 'shame'>('overview')
  const [openTeam, setOpenTeam] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/sweepstake')
      const json: ApiResponse = await res.json()
      if (!res.ok || !json.data) { setError(json.error ?? 'Failed to load'); return }
      setData(json.data)
      setError(null)
      setStaleWarn(json.error ?? null)
    } catch { setError('Connection error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const t = setInterval(fetchData, POLL_MS)
    return () => clearInterval(t)
  }, [fetchData])

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 28, height: 28, border: '2px solid var(--rule)', borderTopColor: 'var(--text2)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading sweepstake…</p>
    </div>
  )

  if (error && !data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, flexDirection: 'column', gap: 12 }}>
      <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>Data unavailable</p>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>{error}</p>
      <button onClick={fetchData} style={{ background: 'var(--ink2)', border: '1px solid var(--rule)', color: 'var(--text)', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        Try again
      </button>
    </div>
  )

  if (!data) return null

  const alive   = data.entries.filter(e => e.status !== 'bust').length
  const busted  = data.entries.filter(e => e.status === 'bust').length
  const sweat   = [...data.entries].filter(e => e.status !== 'bust').sort((a, b) => b.total - a.total)[0]
  const danger  = data.entries.filter(e => e.status === 'danger' || e.status === 'warning')
  const bustList = data.entries.filter(e => e.status === 'bust')
  const active  = data.entries.filter(e => e.status !== 'bust')
  const nextMatch = data.upcomingMatches.find(m => !m.isLive)
  const liveMatch = data.upcomingMatches.find(m => m.isLive)
  const maxGoals = data.teamSummaries[0]?.goals || 1
  const hs = generateHeadlines(data.entries)

  const entryById = new Map(data.entries.map(e => [e.id, e]))

  const s: Record<string, React.CSSProperties> = {
    page:          { maxWidth: 480, margin: '0 auto' },
    pitchHeader:   { background: 'var(--pitch)', position: 'relative', overflow: 'hidden' },
    pitchInner:    { position: 'relative', zIndex: 1, padding: '20px 16px 16px' },
    kicker:        { fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 6 },
    heroTitle:     { fontSize: 26, fontWeight: 900, letterSpacing: '-.04em', lineHeight: 1.05, color: '#fff', marginBottom: 2 },
    heroRule:      { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 14 },
    scoreboard:    { display: 'grid', gridTemplateColumns: '1fr 1px 1fr 1px 1fr', background: 'rgba(0,0,0,0.25)', borderRadius: 6, overflow: 'hidden' },
    sbItem:        { padding: '10px 0', textAlign: 'center' },
    sbDiv:         { background: 'rgba(255,255,255,0.1)', margin: '8px 0' },
    nmBar:         { background: 'var(--ink2)', borderBottom: '1px solid var(--rule)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    tabNav:        { background: 'var(--ink2)', borderBottom: '1px solid var(--rule)', display: 'flex', overflowX: 'auto', position: 'sticky', top: 0, zIndex: 20, scrollbarWidth: 'none' } as React.CSSProperties,
    section:       { borderBottom: '1px solid var(--rule)' },
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      style={{
        flexShrink: 0, padding: '12px 14px',
        fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase',
        color: tab === id ? 'var(--text)' : 'var(--muted)',
        background: 'none',
        borderLeft: 'none', borderRight: 'none', borderTop: 'none',
        borderBottom: `2px solid ${tab === id ? '#22873E' : 'transparent'}`,
        cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
      } as React.CSSProperties}
    >
      {label}
    </button>
  )

  return (
    <div style={s.page}>
      <style>{`
        @keyframes heartbeat {
          0%,100% { box-shadow: inset 0 0 0 1px rgba(192,57,43,.1); }
          40%      { box-shadow: inset 0 0 0 1px rgba(192,57,43,.45), 0 0 28px 0 rgba(192,57,43,.06); }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── PITCH HEADER ─────────────────────────────────────────── */}
      <header style={s.pitchHeader}>
        {/* CSS pitch markings */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)', transform: 'translateX(-50%)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 80, height: 80, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', transform: 'translate(-50%,-50%)' }} />
        </div>
        <div style={s.pitchInner}>
          <div style={s.kicker}>World Cup 2026 · Sweepstake Tracker</div>
          <div style={s.heroTitle}>STAY<br/>UNDER 21</div>
          <div style={s.heroRule}>Go over and you're out. No exceptions.</div>
          <div style={s.scoreboard}>
            <div style={s.sbItem}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-.04em', lineHeight: 1, color: '#6EE89A' }}>{alive}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Alive</div>
            </div>
            <div style={s.sbDiv} />
            <div style={s.sbItem}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-.04em', lineHeight: 1, color: '#fff' }}>{data.totalGoalsScored}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Goals</div>
            </div>
            <div style={s.sbDiv} />
            <div style={s.sbItem}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-.04em', lineHeight: 1, color: '#FF8A80' }}>{busted}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>Busted</div>
            </div>
          </div>
        </div>
      </header>

      {/* ── NEXT MATCH ───────────────────────────────────────────── */}
      {staleWarn && (
        <div style={{ background: 'rgba(200,134,10,0.1)', borderBottom: '1px solid rgba(200,134,10,0.2)', padding: '8px 16px', textAlign: 'center', fontSize: 11, color: '#F5B942', fontWeight: 600 }}>
          ⚠️ {staleWarn}
        </div>
      )}
      <div style={s.nmBar}>
        {liveMatch ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF6B6B', animation: 'blink 1.1s ease-in-out infinite', display: 'inline-block' }} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#FF6B6B' }}>Live</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{liveMatch.homeTeam} vs {liveMatch.awayTeam}</span>
            </div>
            <span style={{ fontSize: 11, color: '#FF8A80', fontWeight: 700 }}>In Progress</span>
          </>
        ) : nextMatch ? (
          <>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>Next match</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{nextMatch.homeTeam} vs {nextMatch.awayTeam}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)' }}>
              {nextMatch.isToday ? `Today · ${formatKickoff(nextMatch.kickoff)}` : formatKickoff(nextMatch.kickoff)}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>No upcoming matches</span>
        )}
      </div>

      {/* ── TABS ─────────────────────────────────────────────────── */}
      <nav style={s.tabNav}>
        {tabBtn('overview', 'Overview')}
        {tabBtn('table',    'Table')}
        {tabBtn('goals',    'Goals')}
        {tabBtn('teams',    'Teams')}
        {tabBtn('shame',    'Shame')}
      </nav>

      {/* ── OVERVIEW ─────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          {/* Headlines */}
          <SectionDivider label="Today's headlines" />
          <div style={s.section}>
            {hs.map((h, i) => (
              <div key={i} style={{ padding: '11px 16px', borderBottom: i < hs.length - 1 ? '1px solid var(--rule2)' : 'none', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--pitch-lt)', letterSpacing: '.08em', flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text2)', lineHeight: 1.45, fontWeight: 500 }}>&ldquo;{h}&rdquo;</span>
              </div>
            ))}
          </div>

          {/* Biggest sweat */}
          <SectionDivider label="Biggest sweat" />
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)' }}>
            {sweat && (
              <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 8, padding: 14, position: 'relative', animation: 'heartbeat 2.8s ease-in-out infinite' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-.03em', textTransform: 'uppercase', color: '#fff', lineHeight: 1 }}>{sweat.name}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(192,57,43,0.65)', letterSpacing: '.08em', marginTop: 3 }}>is sweating</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 42, fontWeight: 900, color: '#FF6B6B', letterSpacing: '-.05em', lineHeight: 1 }}>
                      {sweat.total}<span style={{ fontSize: 17, color: 'var(--dim)', fontWeight: 700 }}>/21</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(192,57,43,0.6)', letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>{sweat.remaining} from bust</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                  {sweat.teams.map(t => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, padding: '7px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 19, lineHeight: 1 }}>{t.flag}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>{t.goals}</span>
                    </div>
                  ))}
                </div>
                <GoalBar total={sweat.total} status={sweat.status} />
              </div>
            )}
          </div>

          {/* Danger zone */}
          <SectionDivider label="Danger zone" />
          <div style={s.section}>
            {danger.length === 0
              ? <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Everyone's comfortable. For now.</div>
              : danger.slice(0, 6).map((e, i) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < Math.min(danger.length, 6) - 1 ? '1px solid var(--rule2)' : 'none', background: e.status === 'danger' ? 'rgba(192,57,43,0.04)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', width: 16, textAlign: 'center' }}>{e.rank}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{e.name}</span>
                    <StatusPill status={e.status} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                    {e.total}<span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600 }}>/21</span>
                  </div>
                </div>
              ))}
          </div>

          {/* Timeline */}
          <SectionDivider label="Tournament timeline" />
          <div style={{ borderBottom: '1px solid var(--rule)', padding: '4px 16px 16px' }}>
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              <div style={{ position: 'absolute', left: 4, top: 8, bottom: 8, width: 1, background: 'var(--rule2)' }} />
              {[
                { dot: '#22873E', date: '11 Jun', text: 'Tournament kicks off. The sweepstake begins.' },
                ...danger.map(e => ({ dot: '#C8860A', date: 'Active', text: `${e.name} enters the danger zone — ${e.total} goals.` })),
                ...bustList.map(e => ({ dot: '#C0392B', date: 'Out', text: `${e.name} eliminated — ${e.total} goals.` })),
                { dot: 'var(--rule2)', date: '19 Jul', text: 'World Cup Final, New York', dim: true },
              ].map((item, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: 16 }}>
                  <div style={{ position: 'absolute', left: -18, top: 5, width: 8, height: 8, borderRadius: '50%', background: item.dot, border: '1.5px solid var(--ink)' }} />
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: 2 }}>{item.date}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: item.dim ? 'var(--dim)' : 'var(--text2)', lineHeight: 1.4 }}>{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── TABLE ────────────────────────────────────────────────── */}
      {tab === 'table' && (
        <div style={s.section}>
          {active.map(e => <LbCard key={e.id} entry={e} entries={data.entries} />)}
          {bustList.length > 0 && (
            <>
              <SectionDivider label="Eliminated" />
              {bustList.map(e => <LbCard key={e.id} entry={e} entries={data.entries} />)}
            </>
          )}
        </div>
      )}

      {/* ── GOALS ────────────────────────────────────────────────── */}
      {tab === 'goals' && (
        <>
          <SectionDivider label="Recent goals" />
          <div style={s.section}>
            {data.goalFeed.length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No goals yet. The suffering hasn't started.</div>
              : data.goalFeed.slice(0, 10).map((ev, i) => {
                  const affected = ev.affectedEntryIds.map(id => entryById.get(id)).filter(Boolean) as SweepstakeEntry[]
                  return (
                    <div key={ev.id} style={{ borderBottom: '1px solid var(--rule2)', padding: '12px 16px', background: i === 0 ? 'rgba(200,134,10,0.03)' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {ev.homeTeam} <span style={{ color: 'var(--paper)', fontWeight: 900 }}>{ev.homeScore}–{ev.awayScore}</span> {ev.awayTeam}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--dim)' }}>{formatRelative(ev.matchTime)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 7 }}>
                        ⚽ {ev.scorerName} {ev.minute}'
                        {ev.isExtraTime && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, background: 'rgba(200,134,10,0.15)', color: '#F5B942', padding: '1px 5px', borderRadius: 3, letterSpacing: '.08em' }}>AET</span>}
                      </div>
                      {affected.length > 0 && (
                        <>
                          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: 5 }}>Affected</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {affected.map(e => (
                              <span key={e.id} style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                                background: e.status === 'danger' ? 'rgba(192,57,43,0.12)' : e.status === 'warning' ? 'rgba(200,134,10,0.12)' : 'var(--ink3)',
                                color: e.status === 'danger' ? '#FF8A80' : e.status === 'warning' ? '#F5B942' : 'var(--text2)',
                              }}>
                                {e.name} +1
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
            }
          </div>

          <SectionDivider label="Deadliest teams" />
          <div style={s.section}>
            {data.teamSummaries.filter(t => t.goals > 0).slice(0, 8).map((t, i) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--rule2)', gap: 10 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', width: 12, textAlign: 'center' }}>{i + 1}</span>
                <span style={{ fontSize: 19, lineHeight: 1, flexShrink: 0 }}>{t.flag}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{t.name}</span>
                <div style={{ flex: 2, height: 2, background: 'var(--ink3)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ height: 2, background: '#C0392B', width: `${Math.round(t.goals / maxGoals * 100)}%`, borderRadius: 1 }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', width: 20, textAlign: 'right', flexShrink: 0 }}>{t.goals}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── TEAMS ────────────────────────────────────────────────── */}
      {tab === 'teams' && (
        <>
          <SectionDivider label="Team ownership" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--rule2)', borderBottom: '1px solid var(--rule)' }}>
            {data.teamSummaries.map(t => (
              <div
                key={t.name}
                onClick={() => setOpenTeam(openTeam === t.name ? null : t.name)}
                style={{ background: 'var(--ink2)', padding: 12, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 24, lineHeight: 1, marginBottom: 5 }}>{t.flag}</div>
                <div style={{ fontSize: 22, fontWeight: 900, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.04em', lineHeight: 1, marginBottom: 2 }}>{t.goals}</div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text2)', marginBottom: 1 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t.ownerIds.length} owner{t.ownerIds.length !== 1 ? 's' : ''}</div>
                {openTeam === t.name && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--rule)' }}>
                    <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--muted)', marginBottom: 5 }}>Picked by</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {t.ownerNames.map((n, i) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 600, background: 'var(--ink3)', border: '1px solid var(--rule)', borderRadius: 3, padding: '2px 6px', color: 'var(--text2)' }}>{n}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── SHAME ────────────────────────────────────────────────── */}
      {tab === 'shame' && (
        <>
          <SectionDivider label="Elimination watch" />
          <div style={s.section}>
            {danger.length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Nobody in danger yet.</div>
              : danger.slice(0, 4).map(e => <LbCard key={e.id} entry={e} entries={data.entries} />)}
          </div>

          <SectionDivider label="Hall of shame" />
          <div style={s.section}>
            {bustList.length === 0
              ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Nobody's out yet. Early doors.</div>
              : bustList.map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid var(--rule2)', opacity: 0.4 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, textTransform: 'uppercase', textDecoration: 'line-through', color: 'var(--muted)', letterSpacing: '-.01em' }}>{e.name}</div>
                    <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>{e.teams.map(t => <span key={t.name} style={{ fontSize: 17 }}>{t.flag}</span>)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#7F1D1D', letterSpacing: '-.04em', lineHeight: 1 }}>{e.total}</div>
                    <div style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', color: '#7F1D1D', opacity: 0.5 }}>Out</div>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer style={{ padding: '20px 16px', textAlign: 'center', borderTop: '1px solid var(--rule)' }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.04em' }}>
          Updates every 60s · <span style={{ color: 'var(--pitch-lt)', fontWeight: 700 }}>Live matches</span> every 5 mins
        </p>
        <p style={{ fontSize: 10, color: 'var(--rule2)', marginTop: 4 }}>Updated {formatRelative(data.lastUpdated)}</p>
      </footer>
    </div>
  )
}
