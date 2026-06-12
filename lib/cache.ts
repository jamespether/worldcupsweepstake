import type { SweepstakeData } from '@/types/sweepstake'

interface CacheEntry {
  data: SweepstakeData
  fetchedAt: number
  ttlMs: number
}

let cache: CacheEntry | null = null

export const TTL = {
  NO_MATCH: 6 * 60 * 60 * 1000,
  MATCH_DAY: 30 * 60 * 1000,
  LIVE: 5 * 60 * 1000,
  POST_TOURNAMENT: 6 * 60 * 60 * 1000,
}

export function getCached(): SweepstakeData | null {
  if (!cache) return null
  if (Date.now() - cache.fetchedAt > cache.ttlMs) return null
  return cache.data
}

export function getStale(): SweepstakeData | null {
  return cache?.data ?? null
}

export function setCached(data: SweepstakeData, ttlMs: number): void {
  cache = {
    data,
    fetchedAt: Date.now(),
    ttlMs,
  }
}

export function getCachedAt(): string | null {
  return cache ? new Date(cache.fetchedAt).toISOString() : null
}

export function selectTtl(opts: {
  liveMatchActive: boolean
  hasMatchToday: boolean
  tournamentOver: boolean
}): number {
  if (opts.tournamentOver) return TTL.POST_TOURNAMENT
  if (opts.liveMatchActive) return TTL.LIVE
  if (opts.hasMatchToday) return TTL.MATCH_DAY
  return TTL.NO_MATCH
}
