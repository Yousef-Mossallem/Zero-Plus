// ==================================================================
// Zero Plus - Reputation Engine (pure)
// ==================================================================

export type BanStatus = 'NONE' | 'TEMPORARY' | 'PERMANENT'

export type ReputationState = {
  score: number
  failedChecks: number
  banStatus: BanStatus
  bannedUntil: Date | null
}

export type ReputationPolicyRules = {
  autoBanAfterFails: number
  temporaryBanMinutes: number
  permanentBanMinScore: number
}

export type ReputationEvent = {
  challengeFailed?: boolean
  scoreDelta?: number
  forcePermanent?: boolean
  positiveSignal?: boolean
}

export function applyReputationEvent(
  current: ReputationState,
  event: ReputationEvent,
  rules: ReputationPolicyRules,
  now: Date = new Date()
): ReputationState {
  let score = current.score
  let failedChecks = current.failedChecks
  let banStatus: BanStatus = current.banStatus
  let bannedUntil: Date | null = current.bannedUntil

  if (event.positiveSignal && !event.challengeFailed && !event.forcePermanent) {
    score = Math.max(1, score - 1)
    return { score, failedChecks, banStatus, bannedUntil }
  }

  if (event.challengeFailed) {
    failedChecks += 1
    score = Math.min(10, score + (event.scoreDelta ?? 1))
  } else if (typeof event.scoreDelta === 'number' && event.scoreDelta > 0) {
    score = Math.min(10, score + event.scoreDelta)
  }

  if (event.forcePermanent) {
    return {
      score: Math.max(score, rules.permanentBanMinScore),
      failedChecks,
      banStatus: 'PERMANENT',
      bannedUntil: null,
    }
  }

  if (score >= rules.permanentBanMinScore) {
    return { score, failedChecks, banStatus: 'PERMANENT', bannedUntil: null }
  }

  if (failedChecks >= rules.autoBanAfterFails && banStatus !== 'PERMANENT') {
    return {
      score,
      failedChecks,
      banStatus: 'TEMPORARY',
      bannedUntil: new Date(now.getTime() + rules.temporaryBanMinutes * 60 * 1000),
    }
  }

  if (
    banStatus === 'TEMPORARY' &&
    bannedUntil &&
    bannedUntil.getTime() > now.getTime()
  ) {
    return { score, failedChecks, banStatus: 'TEMPORARY', bannedUntil }
  }

  if (
    banStatus === 'TEMPORARY' &&
    bannedUntil &&
    bannedUntil.getTime() <= now.getTime()
  ) {
    banStatus = 'NONE'
    bannedUntil = null
  }

  return { score, failedChecks, banStatus, bannedUntil }
}

export function isCurrentlyBanned(
  state: ReputationState,
  now: Date = new Date()
): { banned: boolean; reason?: string } {
  if (state.banStatus === 'PERMANENT') {
    return { banned: true, reason: 'Permanent ban (reputation score critical)' }
  }
  if (
    state.banStatus === 'TEMPORARY' &&
    state.bannedUntil &&
    state.bannedUntil.getTime() > now.getTime()
  ) {
    return {
      banned: true,
      reason: `Temporary ban until ${state.bannedUntil.toISOString()}`,
    }
  }
  return { banned: false }
}