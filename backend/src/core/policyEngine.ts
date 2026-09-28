// ==================================================================
// Zero Plus - Policy Engine (pure)
// ==================================================================

export type PolicyThresholds = {
  allowMaxScore: number
  rateLimitMaxScore: number
  challengeMaxScore: number
  rateLimitRps: number
  rateLimitRequests?: number
  rateLimitWindowSec?: number
  enableJsChallenge?: boolean
}

export type DecisionType = 'ALLOW' | 'RATE_LIMIT' | 'CHALLENGE' | 'BLOCK'

export type PolicyDecision = {
  decision: DecisionType
  riskScore: number
  rateLimitRps?: number
  rateLimitRequests?: number
  rateLimitWindowSec?: number
  requireChallenge?: boolean
  reason: string
}

export function evaluatePolicy(
  riskScore: number,
  policy: PolicyThresholds
): PolicyDecision {
  const score = Math.max(0, Math.min(100, Math.round(riskScore)))

  if (score <= policy.allowMaxScore) {
    return {
      decision: 'ALLOW',
      riskScore: score,
      reason: `Risk ${score} ≤ allow threshold ${policy.allowMaxScore}`,
    }
  }

  if (score <= policy.rateLimitMaxScore) {
    const result: PolicyDecision = {
      decision: 'RATE_LIMIT',
      riskScore: score,
      rateLimitRps: policy.rateLimitRps,
      reason: `Risk ${score} in RATE_LIMIT band (${policy.allowMaxScore + 1}–${policy.rateLimitMaxScore})`,
    }

    if (policy.rateLimitRequests !== undefined) {
      result.rateLimitRequests = policy.rateLimitRequests
    }
    if (policy.rateLimitWindowSec !== undefined) {
      result.rateLimitWindowSec = policy.rateLimitWindowSec
    }

    return result
  }

  if (score <= policy.challengeMaxScore) {
    return {
      decision: 'CHALLENGE',
      riskScore: score,
      requireChallenge: policy.enableJsChallenge !== false,
      reason: `Risk ${score} in CHALLENGE band (${policy.rateLimitMaxScore + 1}–${policy.challengeMaxScore})`,
    }
  }

  return {
    decision: 'BLOCK',
    riskScore: score,
    reason: `Risk ${score} > challenge threshold ${policy.challengeMaxScore}`,
  }
}

export function forcedBlock(reason: string, riskScore = 100): PolicyDecision {
  return { decision: 'BLOCK', riskScore, reason }
}