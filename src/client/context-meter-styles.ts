/**
 * Class names and styles of the CLI context meter. Every value follows the harness's own
 * ContextMeter (ui-conversation), so on a CLI session the meter reads as the one the harness
 * shows for its own models. The fallback positions carry this plugin's names: the harness's
 * are its own and may change.
 * @module dsh-ccgui/client/context-meter-styles
 */

export const METER_CLASS = 'dsh-cli-context'
export const METER_TRIGGER_CLASS = 'dsh-cli-context-trigger'
export const METER_TRACK_CLASS = 'dsh-cli-context-track'
export const METER_FILL_CLASS = 'dsh-cli-context-fill'
export const METER_PANEL_CLASS = 'dsh-cli-context-panel'
export const METER_HEADER_CLASS = 'dsh-cli-context-header'
export const METER_HEADLINE_CLASS = 'dsh-cli-context-headline'
export const METER_PERCENT_CLASS = 'dsh-cli-context-percent'
export const METER_FIGURES_CLASS = 'dsh-cli-context-figures'
export const METER_BAR_CLASS = 'dsh-cli-context-bar'
export const METER_SEGMENT_CLASS = 'dsh-cli-context-segment'

const TRY = '--dsh-cli-context'

export const CONTEXT_METER_STYLES = `
.${METER_CLASS} { display: inline-flex; flex: none; }
.${METER_TRIGGER_CLASS} {
  anchor-name: var(--dsh-cli-context-anchor);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 1px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-variant-numeric: tabular-nums;
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
  cursor: pointer;
}
.${METER_TRIGGER_CLASS}[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
@media (hover: hover) {
  .${METER_TRIGGER_CLASS}:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-secondary);
  }
}
.${METER_TRACK_CLASS} { fill: none; stroke: var(--dsw-alias-border-l3); stroke-width: 2; }
.${METER_FILL_CLASS} { fill: none; stroke: var(--dsw-alias-label-tertiary); stroke-width: 2; stroke-linecap: round; }
.${METER_PANEL_CLASS} {
  position: fixed;
  position-anchor: var(--dsh-cli-context-anchor);
  z-index: 1100;
  box-sizing: border-box;
  width: min(264px, calc(100vw - 24px));
  padding: 12px;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)));
  overflow-x: hidden;
  overflow-y: auto;
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: max(12px, calc(anchor(top) + 8px));
  left: max(12px, anchor(left));
  right: 12px;
  position-try-fallbacks: ${TRY}-window, ${TRY}-opposite, ${TRY}-viewport;
  align-self: end;
  justify-self: start;
  height: fit-content;
  min-height: 0;
  margin: 0;
}
.${METER_HEADER_CLASS} { display: flex; align-items: center; gap: 6px; }
.${METER_FIGURES_CLASS} {
  margin-left: auto;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.${METER_PERCENT_CLASS} { font-weight: 500; color: var(--dsw-alias-label-primary); }
.${METER_HEADLINE_CLASS} { color: var(--dsw-alias-label-tertiary); }
.${METER_BAR_CLASS} {
  display: flex;
  margin: 10px 0 2px;
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.${METER_SEGMENT_CLASS} { flex: none; min-width: 2px; height: 100%; border-radius: 1px; background: var(--dsw-alias-label-tertiary); }
@position-try ${TRY}-window {
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: max(12px, calc(anchor(top) + 8px));
  left: 12px;
  right: 12px;
  margin: 0;
  align-self: safe end;
  justify-self: safe end;
}
@position-try ${TRY}-opposite {
  top: max(12px, calc(anchor(bottom) + 8px));
  bottom: 12px;
  align-self: start;
}
@position-try ${TRY}-viewport {
  position-area: none;
  inset: max(12px, var(--dsh-frame-overlay-top, 12px)) 12px 12px;
  margin: 0;
  align-self: safe start;
  justify-self: safe end;
}
`
