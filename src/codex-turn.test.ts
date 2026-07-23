import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findCompletedConversationTurn,
  findConversationTurnActivity,
  type ConversationMessage,
} from './codex-turn.ts'

const submittedText = 'Bitte erstelle das Spielkonzept.'

test('finds a completed replacement turn for the exact submitted message', () => {
  const messages: ConversationMessage[] = [
    {
      turnId: 'old-turn',
      role: 'assistant',
      text: 'Alte Antwort',
      phase: 'final_answer',
      turnStatus: 'completed',
    },
    {
      turnId: 'persisted-turn',
      role: 'user',
      text: submittedText,
      phase: 'request',
      turnStatus: 'completed',
    },
    {
      turnId: 'persisted-turn',
      role: 'assistant',
      text: 'Das Spielkonzept ist fertig.',
      phase: 'final_answer',
      turnStatus: 'completed',
    },
  ]

  assert.deepEqual(findCompletedConversationTurn(messages, submittedText), messages[2])
})

test('does not consume an unrelated or already completed turn', () => {
  const messages: ConversationMessage[] = [
    {
      turnId: 'completed-turn',
      role: 'user',
      text: submittedText,
      phase: 'request',
      turnStatus: 'completed',
    },
    {
      turnId: 'completed-turn',
      role: 'assistant',
      text: 'Fertig',
      phase: 'final_answer',
      turnStatus: 'completed',
    },
    {
      turnId: 'other-turn',
      role: 'user',
      text: 'Eine andere Aufgabe',
      phase: 'request',
      turnStatus: 'completed',
    },
  ]

  assert.equal(
    findCompletedConversationTurn(messages, submittedText, 'completed-turn'),
    null,
  )
})

test('tracks activity on the persisted turn that contains the exact request', () => {
  const messages: ConversationMessage[] = [
    {
      id: 'request',
      turnId: 'persisted-turn',
      role: 'user',
      text: submittedText,
      phase: 'request',
      turnStatus: 'inProgress',
    },
    {
      id: 'progress',
      turnId: 'persisted-turn',
      role: 'assistant',
      text: 'Ich prüfe die Dateien.',
      phase: 'commentary',
      turnStatus: 'inProgress',
    },
  ]

  const activity = findConversationTurnActivity(messages, submittedText)
  assert.equal(activity?.turnId, 'persisted-turn')
  assert.equal(activity?.hasAssistantActivity, true)
  assert.match(activity?.signature ?? '', /Ich prüfe die Dateien/)
})
