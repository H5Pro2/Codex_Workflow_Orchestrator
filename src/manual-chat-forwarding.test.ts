import assert from 'node:assert/strict'
import test from 'node:test'
import { requestsManualChatForwarding } from './manual-chat-forwarding.ts'

test('recognizes explicit forwarding requests in a direct user chat', () => {
  assert.equal(requestsManualChatForwarding('Weiterleiten bitte'), true)
  assert.equal(requestsManualChatForwarding('weiterleiten an den Prüfer'), true)
  assert.equal(requestsManualChatForwarding('Warum kannst du das nicht weiterleiten?'), true)
  assert.equal(requestsManualChatForwarding('Leite das Ergebnis danach weiter.'), true)
  assert.equal(requestsManualChatForwarding('Übergib deine Antwort an den nächsten Agenten.'), true)
  assert.equal(requestsManualChatForwarding(
    'Korrigiere das und du sollst es weiterleiten, damit wir den Workflow fortsetzen.',
  ), true)
  assert.equal(requestsManualChatForwarding('Kannst du das bitte weiterleiten?'), true)
  assert.equal(requestsManualChatForwarding('Forward the result to the next agent.'), true)
})

test('keeps ordinary and negated user conversations local', () => {
  assert.equal(requestsManualChatForwarding('Erkläre mir bitte das Ergebnis.'), false)
  assert.equal(requestsManualChatForwarding('Warum wurde das Ergebnis weitergeleitet?'), false)
  assert.equal(requestsManualChatForwarding('Bitte nicht an den nächsten Agenten weiterleiten.'), false)
  assert.equal(requestsManualChatForwarding('Weiterleiten bitte nicht.'), false)
  assert.equal(requestsManualChatForwarding('Do not forward this result.'), false)
})
