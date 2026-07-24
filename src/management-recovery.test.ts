import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isCompletedManagementObservation,
  resolveManagementRecoveryTargetId,
} from './management-recovery.ts'

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

test('keeps automation running after an uneventful management observation', () => {
  assert.equal(isCompletedManagementObservation({
    isManagementAgent: true,
    inboundSourceAgentId: '',
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 0,
    resultStatusCount: 0,
  }), true)
})

test('does not treat actionable management results as observations', () => {
  const base = {
    isManagementAgent: true,
    inboundSourceAgentId: '',
    reportsTechnicalFailure: false,
    configuredDeliveryCount: 0,
    resultStatusCount: 0,
  }

  assert.equal(isCompletedManagementObservation({
    ...base,
    inboundSourceAgentId: 'implementation',
  }), false)
  assert.equal(isCompletedManagementObservation({
    ...base,
    reportsTechnicalFailure: true,
  }), false)
  assert.equal(isCompletedManagementObservation({
    ...base,
    configuredDeliveryCount: 1,
  }), false)
  assert.equal(isCompletedManagementObservation({
    ...base,
    resultStatusCount: 1,
  }), false)
})
