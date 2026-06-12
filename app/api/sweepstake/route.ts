import { NextResponse } from 'next/server'
import { getCached, getStale, setCached, getCachedAt, selectTtl } from '@/lib/cache'
import { buildSweepstakeData, buildMockData } from '@/lib/football-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
  const fresh = getCached()

  if (fresh) {
    return NextResponse.json({
      data: fresh,
      cached: true,
      cachedAt: getCachedAt() ?? undefined,
    })
  }

  const hasKey = !!process.env.FOOTBALL_DATA_API_KEY

  try {
    const data = !hasKey ? buildMockData() : await buildSweepstakeData()

    const ttl = selectTtl({
      liveMatchActive: data.liveMatchActive,
      hasMatchToday: data.upcomingMatches.some((match) => match.isToday),
      tournamentOver: !data.liveMatchActive && data.upcomingMatches.length === 0,
    })

    setCached(data, ttl)

    return NextResponse.json({
      data,
      cached: false,
    })
  } catch (err) {
    console.error('[/api/sweepstake] fetch error:', err)

    const stale = getStale()

    if (stale) {
      return NextResponse.json({
        data: stale,
        cached: true,
        cachedAt: getCachedAt() ?? undefined,
        error: 'Live data unavailable — showing last known results',
      })
    }

    return NextResponse.json(
      {
        data: buildMockData(),
        cached: false,
        error: 'Live data unavailable — showing demo data',
      },
      { status: 200 }
    )
  }
}
