import assert from 'node:assert/strict'
import test from 'node:test'
import { workflowConstraintViolation } from './workflow-constraints.ts'

test('blocks a local media requirement that contradicts browser-only playback', () => {
  const issue = workflowConstraintViolation([
    'Erlaubt ist nur Browserwiedergabe ohne Download oder lokale Kopie.',
    'Als Nächstes muss die Originaldatei lokal unter sources/media bereitgestellt werden.',
  ].join('\n'))

  assert.match(issue, /widerspricht einer verbindlichen Browsergrenze/u)
})

test('allows browser playback without a local file requirement', () => {
  assert.equal(workflowConstraintViolation(
    'Das Video spielte im Browser ab. Es gab keinen Download und keine lokale Kopie.',
  ), '')
})

test('allows explicit exclusions even when they name installation and OpenCV', () => {
  assert.equal(workflowConstraintViolation([
    'Der Auftrag bleibt ohne Download oder lokale Kopie.',
    'Harte Ausschlüsse: kein Browserkontakt, kein Download, keine lokale Kopie, keine Installation, kein Transcode, kein dateibasierter OpenCV-Pfad.',
  ].join('\n')), '')
})

test('allows a directly negated download requirement', () => {
  assert.equal(workflowConstraintViolation(
    'Es gilt weiterhin: kein Download. Ein Download ist nicht erforderlich.',
  ), '')
})

test('allows dependencies that explicitly must not be installed later', () => {
  assert.equal(workflowConstraintViolation([
    'Der Auftrag bleibt ohne Download oder lokale Kopie.',
    'Der Schnellnachhallpfad ist wegen fehlendem numpy nicht Teil des Befunds und darf nicht durch Installation oder Ersatzabhängigkeit nachgezogen werden.',
  ].join('\n')), '')
})

test('still blocks an affirmative requirement after a separate exclusion', () => {
  assert.match(workflowConstraintViolation([
    'Es gilt weiterhin: kein Download und keine lokale Kopie.',
    'Die Originaldatei muss dennoch lokal unter sources/media bereitgestellt werden.',
  ].join('\n')), /widerspricht einer verbindlichen Browsergrenze/u)
})

test('blocks a package installation prerequisite for a browser-only handoff', () => {
  assert.match(workflowConstraintViolation([
    'Der Auftrag erlaubt nur Browserwiedergabe ohne Download.',
    'Vor der Fortsetzung müssen numpy, opencv-python und pytest installiert werden.',
  ].join('\n')), /widerspricht einer verbindlichen Browsergrenze/u)
})

test('allows a later local file only after an explicit user override', () => {
  assert.equal(workflowConstraintViolation(
    'Zuvor galt kein Download. Der Benutzer hat eine lokale Datei ausdrücklich erlaubt und freigegeben.',
  ), '')
})
