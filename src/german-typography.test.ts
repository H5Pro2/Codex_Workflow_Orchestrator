import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeGermanTypography } from './german-typography.ts'

test('normalizes common German replacement spellings without changing ordinary words', () => {
  assert.equal(
    normalizeGermanTypography('Prueft fuer den naechsten Agenten und schliesst die Uebergabe ab.'),
    'Prüft für den nächsten Agenten und schließt die Übergabe ab.',
  )
  assert.equal(normalizeGermanTypography('neue Steuerung'), 'neue Steuerung')
})
