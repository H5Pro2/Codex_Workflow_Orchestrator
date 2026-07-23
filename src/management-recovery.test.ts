import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveManagementRecoveryTargetId } from './management-recovery.ts'

test('returns a management response to the agent that reported the failure', () => {
  assert.equal(resolveManagementRecoveryTargetId({
    isManagementAgent: true,
    inboundSourceAgentId: 'implementation',
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 0,
    knownAgentIds: ['implementation', 'ceo'],
  }), 'implementation')
})

test('does not synthesize a recovery route for technical failures or configured deliveries', () => {
  const input = {
    isManagementAgent: true,
    inboundSourceAgentId: 'implementation',
    knownAgentIds: ['implementation', 'ceo'],
  }

  assert.equal(resolveManagementRecoveryTargetId({
    ...input,
    reportsTechnicalFailure: true,
    configuredDeliveryCount: 0,
  }), '')
  assert.equal(resolveManagementRecoveryTargetId({
    ...input,
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 1,
  }), '')
})

test('rejects stale or non-management recovery sources', () => {
  assert.equal(resolveManagementRecoveryTargetId({
    isManagementAgent: false,
    inboundSourceAgentId: 'implementation',
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 0,
    knownAgentIds: ['implementation'],
  }), '')
  assert.equal(resolveManagementRecoveryTargetId({
    isManagementAgent: true,
    inboundSourceAgentId: 'missing',
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 0,
    knownAgentIds: ['implementation'],
  }), '')
})
