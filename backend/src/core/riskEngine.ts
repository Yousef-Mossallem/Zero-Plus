// ==================================================================
// Zero Plus - Risk Engine (pure)
// ==================================================================

export type RiskSignals = {
  isDatacenter?: boolean
  requestRate?: number
  anomalyScore?: number
  fingerprintRisk?: number
  reputationScore?: number
  failedChecks?: number
  threatIntelMatch?: boolean
}

export type RiskWeights = {
  datacenter: number
  highRate: number
  anomaly: number
  fingerprint: number
  reputation: number
  failedChecks: number
  threatIntel: number
}

export const DEFAULT_WEIGHTS: RiskWeights = {
  datacenter: 15,
  highRate: 25,
  anomaly: 30,
  fingerprint: 10,
  reputation: 20,
  failedChecks: 8,
  threatIntel: 25,
}

export function computeRiskScore(
  signals: RiskSignals,
  weights: RiskWeights = DEFAULT_WEIGHTS
): number {
  let score = 0

  if (signals.isDatacenter) score += weights.datacenter

  if (typeof signals.requestRate === 'number' && signals.requestRate > 0) {
    const rate = signals.requestRate
    if (rate >= 20) score += weights.highRate
    else if (rate > 5) score += Math.round(weights.highRate * ((rate - 5) / 15))
  }

  if (typeof signals.anomalyScore === 'number') {
    score += Math.round(weights.anomaly * Math.max(0, Math.min(1, signals.anomalyScore)))
  }

  if (typeof signals.fingerprintRisk === 'number') {
    score += Math.round(weights.fingerprint * Math.max(0, Math.min(1, signals.fingerprintRisk)))
  }

  if (typeof signals.reputationScore === 'number') {
    const rep = Math.max(1, Math.min(10, signals.reputationScore))
    score += Math.round(weights.reputation * ((rep - 1) / 9))
  }

  if (typeof signals.failedChecks === 'number' && signals.failedChecks > 0) {
    score += Math.min(signals.failedChecks, 5) * weights.failedChecks
  }

  if (signals.threatIntelMatch) score += weights.threatIntel

  return Math.max(0, Math.min(100, score))
}