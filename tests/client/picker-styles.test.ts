// @vitest-environment jsdom
/// <reference lib="dom" />

/**
 * The picker's styles: it takes the harness's own model seat beside it, the harness's access
 * control steps aside only for a CLI that reports its own modes, and every class it renders is
 * styled.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as styles from '../../src/client/picker/picker-styles.ts'

const { PICKER_STYLES, PICKER_THUMB_SIZE: _thumb, ...classes } = styles

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

const displayOf = (id: string): string => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`missing ${id}`)
  return getComputedStyle(node).display
}

function composer(picker: string): void {
  document.head.innerHTML = `<style>${PICKER_STYLES}</style>`
  document.body.innerHTML = `
<div data-composer-card>
  <div data-slot="conversation.input.right">${picker}</div>
  <div id="native" data-slot="conversation.input.model"><button type="button">DeepSeek</button></div>
  <button id="access" type="button" aria-label="访问模式：完全权限">完全权限</button>
</div>`
}

describe('PICKER_STYLES', () => {
  it("hides the harness's model seat only beside the picker", () => {
    composer('')
    expect(displayOf('native')).not.toBe('none')
    composer(`<span class="${classes.PICKER_CLASS}"><button type="button">GPT</button></span>`)
    expect(displayOf('native')).toBe('none')
  })

  it("keeps the harness's access control unless the CLI reports modes of its own", () => {
    composer(`<span class="${classes.PICKER_CLASS}"><button type="button">GPT</button></span>`)
    expect(displayOf('access')).not.toBe('none')
    composer(`<span class="${classes.PICKER_CLASS}"><button type="button" data-cli-modes>GPT</button></span>`)
    expect(displayOf('access')).toBe('none')
  })

  // Codex Subscription's label draws its bolt before the model's name; the button keeps one
  // bolt, its own, after the level, the same as for a CLI's fast mode.
  it("moves the bolt another plugin's label draws to after the level", () => {
    const trigger = (label: string): void => {
      document.head.innerHTML = `<style>${PICKER_STYLES}</style>`
      document.body.innerHTML = `
<button class="${classes.PICKER_TRIGGER_CLASS}">
  <span data-plugin-label>${label}</span>
  <span class="${classes.PICKER_LEVEL_CLASS}">极高</span>
  <span id="bolt" class="${classes.PICKER_BOLT_CLASS}" data-hosted-bolt></span>
</button>`
    }
    trigger('<span><svg id="drawn"></svg>GPT-6.2-Sol</span>')
    expect(displayOf('drawn')).toBe('none')
    expect(displayOf('bolt')).not.toBe('none')
    trigger('<span>GPT-6.2-Sol</span>')
    expect(displayOf('bolt')).toBe('none')
  })

  it('styles every class the picker renders', () => {
    for (const name of Object.values(classes)) expect(PICKER_STYLES).toContain(`.${name}`)
  })

  // The composer switches this as its row runs out of width.
  it("follows the composer's compact display", () => {
    expect(PICKER_STYLES).toContain('var(--dsh-composer-model-text-display, block)')
  })
})
