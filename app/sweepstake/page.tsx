import type { Metadata } from 'next'
import SweepstakeClient from './SweepstakeClient'

export const metadata: Metadata = {
  title: 'Sweepstake 2026 · Stay Under 21',
  description: "World Cup 2026 sweepstake. Stay under 21 goals or you're out.",
}

export default function SweepstakePage() {
  return <SweepstakeClient />
}
