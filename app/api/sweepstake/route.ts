import { NextResponse } from 'next/server'
import { getCached, getStale, setCached, getCachedAt, selectTtl } from '@/lib/cache'
import { buildSweepstakeData, buildMockData } from '@/lib/football-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  // Return fresh cache if still valid
  const fresh = getCached()
  if (fresh) {
    return NextResponse.json({ data: fresh, cached: true, cachedAt: getCachedAt() ?? undefined })
  }

  const hasKey = !!process.env.FOOTBALL_API_KEY
  const isDev  = process.env.NODE_ENV === 'development'

  try {
    // Use mock data in dev with no API key — saves quota during development
    const data = (!hasKey && isDev) ? buildMockData() : await buildSweepstakeData()

    const ttl = selectTtl({
      liveMatchActive: data.liveMatchActive,
      hasMatchToday:   data.upcomingMatches.some(m => m.isToday),
      tournamentOver:  !data.liveMatchActive && data.upcomingMatches.length === 0,
    })

    setCached(data, ttl)
    return NextResponse.json({ data, cached: false })
  } catch (err) {
    console.error('[/api/sweepstake] fetch error:', err)

    // Fallback: return stale data rather than a hard error
    const stale = getStale()
    if (stale) {
      return NextResponse.json({
        data: stale, cached: true,
        cachedAt: getCachedAt() ?? undefined,
        error: 'Live data unavailable — showing last known results',
      })
    }

    return NextResponse.json(
      { data: null, cached: false, error: 'Data unavailable. Try again shortly.' },
      { status: 503 }
    )
  }
}
