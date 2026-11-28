/**
 * Class names and styles of the model picker. Only the harness's theme tokens: the surface
 * is its menu surface, the accent its business colour, so the picker follows light, dark and
 * the user's palette. The top level's violet is the literal the harness's own context meter
 * uses, as the design platform ships no violet token.
 * @module dsh-ccgui/client/picker/picker-styles
 */

import { PARTICLE_CANVAS_CLASS } from './particle-field.ts'

const P = 'dsh-cli-picker'
export const PICKER_CLASS = P
export const PICKER_TRIGGER_CLASS = `${P}-trigger`
export const PICKER_LEVEL_CLASS = `${P}-level`
export const PICKER_BOLT_CLASS = `${P}-bolt`
export const PICKER_RISK_CLASS = `${P}-risk`
export const PICKER_CHEVRON_CLASS = `${P}-chevron`
export const PICKER_POPOVER_CLASS = `${P}-popover`
export const PICKER_TABS_CLASS = `${P}-tabs`
export const PICKER_TAB_CLASS = `${P}-tab`
export const PICKER_TAB_NAME_CLASS = `${P}-tab-name`
export const PICKER_SEARCH_CLASS = `${P}-search`
export const PICKER_LIST_CLASS = `${P}-list`
export const PICKER_HEADING_CLASS = `${P}-heading`
export const PICKER_ROW_CLASS = `${P}-row`
export const PICKER_ROW_MARK_CLASS = `${P}-row-mark`
export const PICKER_ROW_NAME_CLASS = `${P}-row-name`
export const PICKER_ROW_NOTE_CLASS = `${P}-row-note`
export const PICKER_ROW_META_CLASS = `${P}-row-meta`
export const PICKER_BADGE_CLASS = `${P}-badge`
export const PICKER_HINT_CLASS = `${P}-hint`
export const PICKER_EFFORT_CLASS = `${P}-effort`
export const PICKER_EFFORT_HEAD_CLASS = `${P}-effort-head`
export const PICKER_ICON_BUTTON_CLASS = `${P}-icon-button`
export const PICKER_EFFORT_NAME_CLASS = `${P}-effort-name`
export const PICKER_EFFORT_WARN_CLASS = `${P}-effort-warn`
export const PICKER_TRACK_CLASS = `${P}-track`
export const PICKER_FILL_CLASS = `${P}-fill`
export const PICKER_STOP_CLASS = `${P}-stop`
export const PICKER_THUMB_CLASS = `${P}-thumb`
export const PICKER_FOOTER_CLASS = `${P}-footer`
export const PICKER_FOOTER_ROW_CLASS = `${P}-footer-row`
export const PICKER_FOOTER_VALUE_CLASS = `${P}-footer-value`
export const PICKER_OPTION_CLASS = `${P}-option`
/** Rows other plugins add to the harness's model menu, shown in the picker (see hosted-slots.tsx). */
export const PICKER_HOSTED_CLASS = `${P}-hosted`
/** The slider's thumb, in pixels; the slider keeps it inside the track by half of it. */
export const PICKER_THUMB_SIZE = 18

const ACCENT = 'var(--dsw-alias-state-business-primary)'
const VIOLET = 'rgb(139, 92, 246)'
const EASE = 'cubic-bezier(0.3, 0.7, 0.3, 1)'
const THUMB = PICKER_THUMB_SIZE

// The picker takes the seat of the harness's own model control on every session, so that
// control is hidden beside it; the anchors set \`display: contents\` inline, hence \`!important\`.
// On a CLI that reports its own modes the harness's access control steps aside too: the CLI's
// mode now lives in the picker, and the button flags a mode without the usual approvals. If the
// harness changes its markup both controls show, and either still works. As the composer's row
// runs out of width it turns the model text off through its own variable; the mark stays.
export const PICKER_STYLES = `
[data-slot="conversation.input.right"]:has(.${P}) + [data-slot="conversation.input.model"] { display: none !important; }
[data-composer-card]:has([data-cli-modes]) [aria-label^="访问模式"] { display: none !important; }
.${P} { position: relative; display: inline-flex; min-width: 0; }
.${PICKER_TRIGGER_CLASS} {
  anchor-name: var(--dsh-cli-picker-anchor);
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 360px; height: 28px; padding: 0 6px 0 8px;
  border: none; border-radius: var(--dsw-radius-sm); outline: none; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; line-height: 20px; cursor: pointer;
}
.${PICKER_TRIGGER_CLASS}:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, ${ACCENT}); }
.${PICKER_TRIGGER_CLASS}:hover:not(:disabled), .${PICKER_TRIGGER_CLASS}[aria-expanded='true'] { background: var(--dsw-alias-interactive-bg-hover); }
.${PICKER_TRIGGER_CLASS}:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.${PICKER_TRIGGER_CLASS} > span:not([class]) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PICKER_LEVEL_CLASS} { flex: none; color: var(--dsw-alias-label-tertiary); }
.${PICKER_TRIGGER_CLASS} > span:not([class]), .${PICKER_LEVEL_CLASS} { display: var(--dsh-composer-model-text-display, block); }
.${PICKER_BOLT_CLASS} { display: inline-flex; flex: none; color: var(--dsw-alias-label-primary); }
/* Another plugin's label (Codex Subscription's) draws its bolt before the model's name; the
   button shows its own after the level instead, where a CLI's fast mode shows it. */
.${PICKER_TRIGGER_CLASS} [data-plugin-label] svg { display: none; }
.${PICKER_BOLT_CLASS}[data-hosted-bolt] { display: none; }
.${PICKER_TRIGGER_CLASS}:has([data-plugin-label] svg) .${PICKER_BOLT_CLASS}[data-hosted-bolt] { display: inline-flex; }
.${PICKER_RISK_CLASS} { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }
.${PICKER_CHEVRON_CLASS} { flex: none; color: var(--dsw-alias-label-caption); transition: transform 0.15s; }
.${PICKER_TRIGGER_CLASS}[aria-expanded='true'] .${PICKER_CHEVRON_CLASS} { transform: rotate(180deg); }

.${PICKER_POPOVER_CLASS} {
  position: fixed; position-anchor: var(--dsh-cli-picker-anchor); z-index: 1100; box-sizing: border-box;
  bottom: calc(anchor(top) + 8px); right: anchor(right); top: auto; left: auto;
  position-try-fallbacks: flip-block, flip-inline;
  width: min(288px, calc(100vw - 24px)); max-height: calc(100dvh - 24px - max(12px, var(--dsh-frame-overlay-top, 12px)));
  display: flex; flex-direction: column; overflow: hidden; margin: 0; padding: 0; border: 0;
  border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary); font-size: 13px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  animation: ${P}-in 0.15s ease;
}
@keyframes ${P}-in { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
.${PICKER_TABS_CLASS} { display: flex; align-items: center; gap: 2px; padding: 4px 8px 0; }
.${PICKER_TAB_CLASS} {
  position: relative; display: flex; align-items: center; padding: 6px 8px 7px; border: none; border-radius: 6px 6px 0 0;
  background: none; color: var(--dsw-alias-label-tertiary); font: inherit; cursor: pointer;
}
.${PICKER_TAB_CLASS}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${PICKER_TAB_CLASS}[aria-selected='true']::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; border-radius: 2px; background: ${ACCENT}; }
.${PICKER_TAB_CLASS}:disabled { opacity: 0.3; cursor: not-allowed; }
.${PICKER_TAB_NAME_CLASS} { max-width: 0; margin-left: 0; overflow: hidden; font-size: 12px; white-space: nowrap; transition: max-width 0.2s, margin-left 0.2s; }
.${PICKER_TAB_CLASS}[aria-selected='true'] .${PICKER_TAB_NAME_CLASS} { max-width: 120px; margin-left: 5px; color: var(--dsw-alias-label-primary); }
.${PICKER_SEARCH_CLASS} {
  display: flex; align-items: center; gap: 6px; margin: 6px 8px 0; padding: 5px 8px; border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-caption);
}
.${PICKER_SEARCH_CLASS} input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.${PICKER_LIST_CLASS} { max-height: 176px; overflow-y: auto; padding: 4px; }
.${PICKER_HEADING_CLASS} { padding: 5px 8px 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 500; }
.${PICKER_ROW_CLASS} {
  box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: none;
  border-radius: var(--dsw-radius-sm); line-height: 20px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.${PICKER_ROW_CLASS}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${PICKER_ROW_CLASS}[aria-checked='true'] { background: var(--dsw-alias-interactive-bg-active); }
.${PICKER_ROW_CLASS}:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.${PICKER_ROW_MARK_CLASS} { display: inline-flex; justify-content: center; width: 14px; flex: none; }
.${PICKER_ROW_NAME_CLASS} { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PICKER_ROW_NOTE_CLASS} { flex: none; color: var(--dsw-alias-label-caption); font-size: 11px; }
.${PICKER_ROW_META_CLASS} { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.${PICKER_BADGE_CLASS} { flex: none; padding: 0 5px; border-radius: 5px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 16px; }
.${PICKER_BADGE_CLASS}[data-tone='info'] { color: ${ACCENT}; }
.${PICKER_BADGE_CLASS}[data-tone='success'] { color: var(--dsw-alias-state-success-primary); }
.${PICKER_BADGE_CLASS}[data-tone='warning'] { color: var(--dsw-alias-state-warn-primary); }
.${PICKER_HINT_CLASS} { padding: 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-align: center; }
.${PICKER_HINT_CLASS} button { margin-left: 6px; border: none; background: none; color: ${ACCENT}; font: inherit; cursor: pointer; }

.${PICKER_EFFORT_HEAD_CLASS} { display: grid; grid-template-columns: 28px 1fr 28px; align-items: center; padding: 6px 8px 0; text-align: center; }
.${PICKER_ICON_BUTTON_CLASS} {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none;
  border-radius: 6px; background: none; color: var(--dsw-alias-label-caption); cursor: pointer;
  transition: color 0.2s, transform 0.12s;
}
.${PICKER_ICON_BUTTON_CLASS}:hover { color: var(--dsw-alias-label-secondary); }
.${PICKER_ICON_BUTTON_CLASS}:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, ${ACCENT}); }
.${PICKER_ICON_BUTTON_CLASS}:active { transform: scale(0.86); }
.${PICKER_ICON_BUTTON_CLASS}[aria-pressed='true'] { color: ${ACCENT}; }
.${PICKER_ICON_BUTTON_CLASS}[hidden] { display: inline-flex; visibility: hidden; }
.${PICKER_EFFORT_NAME_CLASS} { display: inline-block; color: ${ACCENT}; font-size: 13px; font-weight: 600; line-height: 18px; transition: color 0.3s; }
.${PICKER_EFFORT_NAME_CLASS}[data-top='true'] { color: ${VIOLET}; }
.${PICKER_EFFORT_NAME_CLASS}[data-bump] { animation: ${P}-bump 0.24s ease; }
@keyframes ${P}-bump { from { opacity: 0.3; transform: scale(0.82); } }
.${PICKER_EFFORT_WARN_CLASS} { color: ${VIOLET}; font-size: 11px; line-height: 14px; }
.${PICKER_TRACK_CLASS} {
  position: relative; height: ${THUMB}px; margin: 6px 12px 10px; border-radius: ${THUMB / 2}px;
  background: var(--dsw-alias-interactive-bg-active); cursor: pointer; touch-action: none; outline: none;
}
.${PICKER_TRACK_CLASS}:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, ${ACCENT}); }
.${PICKER_FILL_CLASS} {
  position: absolute; top: 0; bottom: 0; left: 0; overflow: hidden; border-radius: ${THUMB / 2}px; background: ${ACCENT};
  transition: width 0.26s ${EASE}, background 0.4s;
}
.${PICKER_FILL_CLASS}[data-top='true'] { background: linear-gradient(90deg, ${ACCENT} 0%, rgb(124, 92, 246) 60%, rgb(154, 92, 243) 100%); }
.${PARTICLE_CANVAS_CLASS} { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.${PICKER_STOP_CLASS} { position: absolute; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: var(--dsw-alias-label-dimmed); pointer-events: none; }
.${PICKER_THUMB_CLASS} {
  position: absolute; top: 50%; width: ${THUMB}px; height: ${THUMB}px; margin: -${THUMB / 2}px 0 0 -${THUMB / 2}px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); pointer-events: none; transition: left 0.26s ${EASE}, transform 0.15s;
}
.${PICKER_TRACK_CLASS}[data-dragging] .${PICKER_THUMB_CLASS}, .${PICKER_TRACK_CLASS}[data-dragging] .${PICKER_FILL_CLASS} { transition: none; }
.${PICKER_TRACK_CLASS}[data-dragging] .${PICKER_THUMB_CLASS} { transform: scale(1.08); }

/* One rule parts the model choice from the settings below it; whichever settings block comes first carries it. */
.${PICKER_EFFORT_CLASS}, .${PICKER_HOSTED_CLASS}, .${PICKER_FOOTER_CLASS} { border-top: 1px solid var(--dsw-alias-border-l2); }
:is(.${PICKER_EFFORT_CLASS}, .${PICKER_HOSTED_CLASS}:not(:empty), .${PICKER_FOOTER_CLASS}) ~ :is(.${PICKER_EFFORT_CLASS}, .${PICKER_HOSTED_CLASS}, .${PICKER_FOOTER_CLASS}) { border-top: 0; }
.${PICKER_HOSTED_CLASS} { display: flex; flex-direction: column; padding: 2px 0; }
.${PICKER_HOSTED_CLASS} > [role='menuitem'] { height: 30px; padding: 0 12px; border-radius: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.${PICKER_HOSTED_CLASS}:empty { display: none; }
.${PICKER_FOOTER_ROW_CLASS} {
  box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 7px 12px;
  border: none; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.${PICKER_FOOTER_ROW_CLASS}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${PICKER_FOOTER_VALUE_CLASS} { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-tertiary); }
.${PICKER_FOOTER_VALUE_CLASS} svg { transition: transform 0.15s; }
.${PICKER_FOOTER_ROW_CLASS}[aria-expanded='true'] .${PICKER_FOOTER_VALUE_CLASS} svg { transform: rotate(90deg); }
.${PICKER_OPTION_CLASS} {
  box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 12px 5px 18px; border: none;
  background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.${PICKER_OPTION_CLASS}:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${PICKER_OPTION_CLASS} svg { visibility: hidden; }
.${PICKER_OPTION_CLASS}[aria-checked='true'] svg { visibility: visible; }

@media (prefers-reduced-motion: reduce) {
  .${P} *, .${PICKER_POPOVER_CLASS}, .${PICKER_POPOVER_CLASS} * { transition: none !important; animation: none !important; }
}
`
