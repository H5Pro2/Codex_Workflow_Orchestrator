import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conversationMessageLimit,
  selectConversationWindow,
} from './conversation-window.mjs'

test('returns only the newest conversation messages for the UI', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({ id: index }))
  const selected = selectConversationWindow(messages, 120)
  assert.equal(selected.length, 120)
  assert.equal(selected[0].id, 80)
  assert.equal(selected.at(-1).id, 199)
})

test('bounds invalid and excessive conversation limits', () => {
  assert.equal(conversationMessageLimit('invalid'), 120)
  assert.equal(conversationMessageLimit(5_000), 500)
})
