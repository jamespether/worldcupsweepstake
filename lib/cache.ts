/**
 * In-memory cache for sweepstake data.
 *
 * UPGRADE TO VERCEL KV (for persistence across cold starts):
 *   npm install @vercel/kv
 *   Then replace get/set below with:
 *
 *   import { kv } from '@vercel/kv'
 *   export async function getCached() { return kv.get<SweepstakeData>('sweepstake') }
 *   export async function setCached(d: SweepstakeData, ttlMs: number) {
 *     await kv.set('sweepstake', d, { ex: Math.floor(ttlMs / 1000) })
 *   }
 */

import type { SweepstakeData } from '@/types/sweepstake'

interface CacheEntry {
  data: SweepstakeData
  fetchedAt: number
  ttlMs: number
}

// Module-level — lives for the lifetime of the serverless instance
let cache: CacheEntry | null = null

export const TTL = {
  NO_MATCH:        6 * 60 * 60 * 1000,  // 6 hours
  MATCH_DAY:      30 * 60 * 1000,        // 30 minutes
  LIVE:            5 * 60 * 1000,        // 5 minutes
  POST_TOURNAMENT: 6 * 60 * 60 * 1000,  // 6 hours
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
  cache = { data, fetchedAt: Date.now(), ttlMs }
}

export function getCachedAt(): string | null {
  return cache ? new Date(cache.fetchedAt).toISOString() : null
}

export function selectTtl(opts: {
  liveMatchActive: boolean
  hasMatchToday: boolean
  tournamentOver: boolean
}): number {
  if (opts.tournamentOver)   return TTL.POST_TOURNAMENT
  if (opts.liveMatchActive)  return TTL.LIVE
  if (opts.hasMatchToday)    return TTL.MATCH_DAY
  return TTL.NO_MATCH
}
