import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAffirmativeUserConfirmation,
  parseUserConfirmationRequest,
  parseUserInteractionRequest,
  parseUserQuestionRequest,
  userInteractionInstruction,
} from './user-confirmation.ts'

test('extracts an explicit human confirmation command', () => {
  const result = [
    '## Nächster begrenzter Forschungslauf',
    '',
    'Benötigt wird eine eigenständige aktuelle menschliche Bestätigung:',
    '',
    '```text',
    'AUFBAU BEREIT, KAMERA 0, ENTSCHEIDUNG BEREIT',
    '```',
  ].join('\n')

  assert.deepEqual(parseUserConfirmationRequest(result, '2026-07-28T00:00:00.000Z'), {
    kind: 'confirmation',
    reason: 'Benötigt wird eine eigenständige aktuelle menschliche Bestätigung',
    confirmationText: 'AUFBAU BEREIT, KAMERA 0, ENTSCHEIDUNG BEREIT',
    requestedAt: '2026-07-28T00:00:00.000Z',
    forwardAfterConfirmation: false,
    resumeAutomation: false,
    dismissed: false,
  })
})

test('extracts a tagged user question', () => {
  const result = [
    'Der Versuchsaufbau ist bereit.',
    '',
    '<orchestrator_user_question>Kannst du während der Aufnahme mehrfach deutlich im Kamerabild klatschen?</orchestrator_user_question>',
  ].join('\n')

  assert.deepEqual(parseUserQuestionRequest(result, '2026-07-28T00:00:00.000Z'), {
    kind: 'question',
    reason: 'Kannst du während der Aufnahme mehrfach deutlich im Kamerabild klatschen?',
    confirmationText: '',
    requestedAt: '2026-07-28T00:00:00.000Z',
    forwardAfterConfirmation: false,
    resumeAutomation: false,
    dismissed: false,
  })
})

test('recognizes a direct natural-language action question as fallback', () => {
  const question = 'Kannst du während der Aufnahme mehrfach ein gleichzeitig sichtbares und hörbares Referenzereignis vor Kamera und Mikrofon auslösen, beispielsweise deutlich im Kamerabild klatschen?'
  assert.equal(parseUserInteractionRequest(question)?.reason, question)
})

test('ignores rhetorical and reported questions', () => {
  assert.equal(parseUserQuestionRequest('Die fachliche Frage lautet: Welche Mechanik wäre sinnvoll?'), null)
  assert.equal(parseUserQuestionRequest('Der Benutzer fragte: Kannst du das prüfen? Weitere Arbeit ist möglich.'), null)
})

test('instructs agents to use the dedicated question block only when blocked', () => {
  const instruction = userInteractionInstruction()
  assert.match(instruction, /<orchestrator_user_question>/u)
  assert.match(instruction, /tatsächlich nicht weiterarbeiten/u)
  assert.match(instruction, /keinen Workflow-Status/u)
})

test('ignores negated or merely discussed confirmations', () => {
  assert.equal(parseUserConfirmationRequest([
    'Es ist keine menschliche Bestätigung erforderlich.',
    '```text',
    'BESTÄTIGT',
    '```',
  ].join('\n')), null)
  assert.equal(parseUserConfirmationRequest('Die frühere Benutzerbestätigung wurde dokumentiert.'), null)
})

test('requires a concrete confirmation text', () => {
  assert.equal(parseUserConfirmationRequest(
    'Benötigt wird eine aktuelle menschliche Bestätigung.',
  ), null)
})

test('recognizes subject-first German and English confirmation requests', () => {
  assert.equal(parseUserConfirmationRequest([
    'Benutzerbestätigung ist erforderlich:',
    '```text',
    'VERSUCH FREIGEGEBEN',
    '```',
  ].join('\n'))?.confirmationText, 'VERSUCH FREIGEGEBEN')

  assert.equal(parseUserConfirmationRequest([
    'Explicit user confirmation is required:',
    '```text',
    'RUN APPROVED',
    '```',
  ].join('\n'))?.confirmationText, 'RUN APPROVED')
})

test('recognizes correctly encoded German confirmation requests', () => {
  const result = [
    'Ich benötige eine menschliche Bestätigung:',
    '',
    '```text',
    'AUFBAU BEREIT',
    '```',
  ].join('\n')
  assert.equal(parseUserConfirmationRequest(result)?.confirmationText, 'AUFBAU BEREIT')
})

test('recognizes the mandatory confirmation block', () => {
  const result = [
    '<orchestrator_user_confirmation>',
    'Frage: Bitte bestätige den Kameraaufbau?',
    'Antwort: AUFBAU BEREIT, KAMERA 0',
    '</orchestrator_user_confirmation>',
  ].join('\n')
  assert.deepEqual(parseUserConfirmationRequest(result)?.confirmationText, 'AUFBAU BEREIT, KAMERA 0')
})

test('recognizes a direct exact reply after a required user action', () => {
  assert.equal(parseUserConfirmationRequest([
    'Der freigegebene OpenCV-Lauf bleibt bis zur realen Benutzerhandlung ausgesetzt.',
    '',
    'Bitte alle Anwendungen mit möglichem Kamerazugriff schließen und danach exakt antworten:',
    '',
    '`geschlossen`',
  ].join('\n'))?.confirmationText, 'geschlossen')

  assert.equal(parseUserConfirmationRequest([
    'Required user action: close every application using the camera, then reply exactly:',
    '',
    '`closed`',
  ].join('\n'))?.confirmationText, 'closed')
})

test('does not treat a reported exact reply command as a new confirmation request', () => {
  assert.equal(parseUserConfirmationRequest([
    'Der Prüfer dokumentiert den früheren Wortlaut:',
    'Bitte danach exakt antworten: `geschlossen`.',
    'Die Arbeit kann unabhängig davon fortgesetzt werden.',
  ].join('\n')), null)
})

test('recognizes only clear short confirmations for a previously dismissed request', () => {
  assert.equal(isAffirmativeUserConfirmation('Okay'), true)
  assert.equal(isAffirmativeUserConfirmation('So machen wir weiter.'), true)
  assert.equal(isAffirmativeUserConfirmation('Okay, erkläre mir vorher noch den Aufbau.'), false)
  assert.equal(isAffirmativeUserConfirmation('Nein'), false)
})
