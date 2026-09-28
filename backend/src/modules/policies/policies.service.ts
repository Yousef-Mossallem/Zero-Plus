// ==================================================================
// Zero Plus - Policies Service
// ==================================================================

import type { FastifyInstance } from 'fastify'
import type { UpdatePolicyInput } from './policies.schema.js'
import { DEFAULT_POLICY } from './policies.schema.js'

export class PoliciesService {
  constructor(private fastify: FastifyInstance) {}

  async getPolicyByOrganization(organizationId: string) {
    let policy = await this.fastify.prisma.policy.findUnique({
      where: { organizationId },
    })

    if (!policy) {
      policy = await this.fastify.prisma.policy.create({
        data: {
          organizationId,
          ...DEFAULT_POLICY,
        },
      })
    }

    return policy
  }

  async updatePolicy(organizationId: string, input: UpdatePolicyInput) {
    const current = await this.getPolicyByOrganization(organizationId)

    const nextAllow = input.allowMaxScore ?? current.allowMaxScore
    const nextRate = input.rateLimitMaxScore ?? current.rateLimitMaxScore
    const nextChallenge = input.challengeMaxScore ?? current.challengeMaxScore

    if (nextAllow > nextRate || nextRate > nextChallenge) {
      throw new Error('INVALID_THRESHOLDS')
    }

    return await this.fastify.prisma.policy.update({
      where: { organizationId },
      data: {
        ...(input.allowMaxScore !== undefined && {
          allowMaxScore: input.allowMaxScore,
        }),
        ...(input.rateLimitMaxScore !== undefined && {
          rateLimitMaxScore: input.rateLimitMaxScore,
        }),
        ...(input.challengeMaxScore !== undefined && {
          challengeMaxScore: input.challengeMaxScore,
        }),
        ...(input.rateLimitRequests !== undefined && {
          rateLimitRequests: input.rateLimitRequests,
        }),
        ...(input.rateLimitWindowSec !== undefined && {
          rateLimitWindowSec: input.rateLimitWindowSec,
        }),
        ...(input.rateLimitRps !== undefined && {
          rateLimitRps: input.rateLimitRps,
        }),
        ...(input.autoBanAfterFails !== undefined && {
          autoBanAfterFails: input.autoBanAfterFails,
        }),
        ...(input.temporaryBanMinutes !== undefined && {
          temporaryBanMinutes: input.temporaryBanMinutes,
        }),
        ...(input.permanentBanMinScore !== undefined && {
          permanentBanMinScore: input.permanentBanMinScore,
        }),
        ...(input.enableJsChallenge !== undefined && {
          enableJsChallenge: input.enableJsChallenge,
        }),
        ...(input.enableAiAnomaly !== undefined && {
          enableAiAnomaly: input.enableAiAnomaly,
        }),
      },
    })
  }

  async getGatewayPolicy(organizationId: string) {
    const policy = await this.getPolicyByOrganization(organizationId)

    return {
      organizationId: policy.organizationId,
      allowMaxScore: policy.allowMaxScore,
      rateLimitMaxScore: policy.rateLimitMaxScore,
      challengeMaxScore: policy.challengeMaxScore,
      rateLimitRequests: policy.rateLimitRequests,
      rateLimitWindowSec: policy.rateLimitWindowSec,
      rateLimitRps: policy.rateLimitRps,
      autoBanAfterFails: policy.autoBanAfterFails,
      temporaryBanMinutes: policy.temporaryBanMinutes,
      permanentBanMinScore: policy.permanentBanMinScore,
      enableJsChallenge: policy.enableJsChallenge,
      enableAiAnomaly: policy.enableAiAnomaly,
    }
  }
}