/**
 * The bilingual layer.
 *
 * Two things matter here: both language packs must carry exactly the same
 * keys (a missing translation must fail the tests, not blank a label), and
 * the plugin must follow the browser until the user pins a language.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LANG,
  I18n,
  PACKAGES,
  detectLanguage,
  normalizeLang,
} from '../../web/core/i18n.js'
import { timingText } from '../../web/ui/timing_text.js'
import {
  runButtonTooltipBody,
  runButtonTooltipTitle,
} from '../../web/ui/run_button.js'
import { STATUS } from '../../web/core/task_model.js'

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  }
}

test('both language packs carry exactly the same keys', () => {
  const zh = Object.keys(PACKAGES['zh-CN']).sort()
  const en = Object.keys(PACKAGES.en).sort()
  assert.deepEqual(en, zh)
})

test('no language pack carries an empty string', () => {
  for (const [lang, pack] of Object.entries(PACKAGES)) {
    for (const [key, value] of Object.entries(pack)) {
      assert.equal(typeof value, 'string', lang + ' / ' + key)
      assert.ok(value.length > 0, lang + ' / ' + key)
    }
  }
})

test('a browser tag maps onto a supported pack', () => {
  assert.equal(normalizeLang('zh-CN'), 'zh-CN')
  assert.equal(normalizeLang('zh-Hant-TW'), 'zh-CN')
  assert.equal(normalizeLang('en-GB'), 'en')
  assert.equal(normalizeLang('fr-FR'), null)
})

test('outside a browser the default language is used', () => {
  assert.equal(detectLanguage(), null)
  const i18n = new I18n({ storage: fakeStorage() })
  assert.equal(i18n.lang, DEFAULT_LANG)
})

test('a pinned language survives a reload', () => {
  const storage = fakeStorage()
  const i18n = new I18n({ storage })
  i18n.setLanguage('en')
  assert.equal(i18n.lang, 'en')
  assert.equal(i18n.preference, 'en')
  const reloaded = new I18n({ storage })
  assert.equal(reloaded.lang, 'en')
})

test('following the browser again restores the default', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  i18n.setLanguage('en')
  i18n.setLanguage('auto')
  assert.equal(i18n.preference, 'auto')
  assert.equal(i18n.lang, DEFAULT_LANG)
})

test('an unknown key falls back to the key itself', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  assert.equal(i18n.t('nothing.here'), 'nothing.here')
})

test('placeholders are filled in', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  i18n.setLanguage('en')
  assert.equal(i18n.t('card.outputs', { count: 3 }), '3 output(s)')
})

test('a language change notifies the listeners once', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  const seen = []
  const stop = i18n.subscribe((lang) => seen.push(lang))
  i18n.setLanguage('en')
  stop()
  i18n.setLanguage('zh-CN')
  assert.deepEqual(seen, ['en'])
})

test('the timing line follows the language', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  i18n.setLanguage('en')
  const translate = (key, params) => i18n.t(key, params)
  const record = { status: STATUS.RUNNING, executionStartedAt: 1000 }
  assert.equal(timingText(record, 6500, translate), 'Running for 00:05')
  const pending = {
    status: STATUS.BACKEND_PENDING,
    submittedAt: 1000,
    queuePosition: 2,
  }
  assert.equal(
    timingText(pending, 4000, translate),
    'Backend queue 00:03 · position 2'
  )
})

test('the run button tooltip follows the language', () => {
  const i18n = new I18n({ storage: fakeStorage() })
  i18n.setLanguage('en')
  const translate = (key, params) => i18n.t(key, params)
  assert.equal(runButtonTooltipTitle(translate), 'Plugin run (frozen parameters)')
  assert.ok(runButtonTooltipBody(translate).includes('freezes'))
})
