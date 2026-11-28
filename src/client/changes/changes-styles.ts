/**
 * Class names and CSS of the 变更 panel. The look follows the DSH workspace plugin's change
 * lists: 28px rows in the interface font, the file name first and its folder dimmed, a small
 * tinted status mark, hairline borders, and red only where something would be lost. Every
 * colour is a harness theme token, so the light and dark themes need no pair of their own.
 * @module dsh-ccgui/client/changes/changes-styles
 */

const P = 'dsh-ccgui-changes'

export const CLS = {
  panel: P,
  header: `${P}-header`,
  headerRow: `${P}-header-row`,
  title: `${P}-title`,
  distance: `${P}-distance`,
  headerButtons: `${P}-header-buttons`,
  headerButton: `${P}-header-button`,
  spinning: `${P}-spinning`,
  branchMenu: `${P}-branch-menu`,
  branchButton: `${P}-branch-button`,
  branchName: `${P}-branch-name`,
  branchForm: `${P}-branch-form`,
  branchInput: `${P}-branch-input`,
  remoteItem: `${P}-remote-item`,
  remoteTag: `${P}-remote-tag`,
  summary: `${P}-summary`,
  summaryTitle: `${P}-summary-title`,
  summarySelected: `${P}-summary-selected`,
  scroll: `${P}-scroll`,
  list: `${P}-list`,
  group: `${P}-group`,
  groupHeader: `${P}-group-header`,
  groupTitle: `${P}-group-title`,
  groupCount: `${P}-group-count`,
  groupActions: `${P}-group-actions`,
  groupAction: `${P}-group-action`,
  danger: `${P}-danger`,
  collapsed: `${P}-collapsed`,
  row: `${P}-row`,
  checkbox: `${P}-checkbox`,
  letter: `${P}-letter`,
  path: `${P}-path`,
  dir: `${P}-dir`,
  name: `${P}-name`,
  stats: `${P}-stats`,
  add: `${P}-add`,
  del: `${P}-del`,
  rowActions: `${P}-row-actions`,
  iconButton: `${P}-icon-button`,
  empty: `${P}-empty`,
  error: `${P}-error`,
  commit: `${P}-commit`,
  commitInput: `${P}-commit-input`,
  commitRow: `${P}-commit-row`,
  commitButton: `${P}-commit-button`,
  commitNote: `${P}-commit-note`,
  aiButton: `${P}-ai-button`,
  diff: `${P}-diff`,
  diffHeader: `${P}-diff-header`,
  diffPath: `${P}-diff-path`,
  diffSide: `${P}-diff-side`,
  diffBody: `${P}-diff-body`,
  diffHunk: `${P}-diff-hunk`,
  diffNote: `${P}-diff-note`,
  diffLine: `${P}-diff-line`,
  diffNumber: `${P}-diff-number`,
  diffText: `${P}-diff-text`,
} as const

const HAIRLINE = '.5px solid var(--dsw-alias-border-l2)'
const MONO = 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'
const ACCENT = 'var(--dsw-alias-state-business-primary)'

const LAYOUT = `
.${CLS.panel} { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.${CLS.header} { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: ${HAIRLINE}; }
.${CLS.headerRow} { display: flex; align-items: center; gap: 8px; }
.${CLS.title} { font-size: 14px; font-weight: 500; }
.${CLS.distance} { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-family: ${MONO}; }
.${CLS.headerButtons} { margin-left: auto; display: flex; gap: 2px; }
.${CLS.headerButton}, .${CLS.iconButton} { display: inline-flex; align-items: center; justify-content: center; padding: 0;
  border: none; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.${CLS.headerButton} { width: 28px; height: 28px; }
.${CLS.iconButton} { width: 22px; height: 22px; }
.${CLS.headerButton}:hover:not(:disabled), .${CLS.iconButton}:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLS.headerButton}:disabled { cursor: default; opacity: 0.4; }
.${CLS.spinning} { animation: ${P}-spin 0.8s linear infinite; }
@keyframes ${P}-spin { to { transform: rotate(360deg); } }
.${CLS.branchMenu} { display: block; }
.${CLS.branchButton} { box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.${CLS.branchButton}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${CLS.branchButton}:disabled { cursor: default; opacity: 0.5; }
.${CLS.branchName} { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
  color: var(--dsw-alias-label-primary); font-family: ${MONO}; font-size: 12px; }
.${CLS.branchForm} { display: flex; align-items: center; gap: 6px; }
.${CLS.branchInput} { box-sizing: border-box; flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: var(--dsw-radius-sm, 8px);
  border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; font-size: 12.5px; outline: none; }
.${CLS.branchInput}:focus { border-color: ${ACCENT}; }
.${CLS.remoteItem} { display: inline-flex; gap: 6px; align-items: baseline; }
.${CLS.remoteTag} { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.${CLS.summary} { display: flex; align-items: baseline; gap: 6px; padding: 8px 12px 4px; font-size: 12.5px; }
.${CLS.summary} .${CLS.add}, .${CLS.summary} .${CLS.del} { font-family: ${MONO}; font-size: 11.5px; }
.${CLS.summaryTitle} { font-weight: 500; }
.${CLS.summarySelected} { margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.${CLS.scroll} { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 8px; }
.${CLS.group} + .${CLS.group} { margin-top: 4px; }
.${CLS.groupHeader} { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 2px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; user-select: none; }
.${CLS.groupTitle} { font-weight: 500; }
.${CLS.groupCount} { color: var(--dsw-alias-label-tertiary); }
.${CLS.groupActions} { margin-left: auto; display: flex; gap: 2px; opacity: 0; transition: opacity 0.12s; }
.${CLS.groupHeader}:hover .${CLS.groupActions}, .${CLS.groupHeader}:focus-within .${CLS.groupActions} { opacity: 1; }
.${CLS.groupAction} { border: none; background: transparent; padding: 1px 6px; border-radius: var(--dsw-radius-xs, 4px);
  font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.${CLS.groupAction}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLS.groupAction}.${CLS.danger}:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); }
.${CLS.groupAction}:disabled { cursor: default; opacity: 0.5; }
.${CLS.collapsed} { transform: rotate(-90deg); }
.${CLS.checkbox} { width: 13px; height: 13px; margin: 0; flex: none; accent-color: ${ACCENT}; cursor: pointer; }
.${CLS.empty} { padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.${CLS.error} { display: flex; align-items: flex-start; gap: 8px; margin: 8px 12px 0; padding: 6px 10px;
  border-radius: var(--dsw-radius-sm, 8px); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px;
  white-space: pre-wrap; word-break: break-word; background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover)); }
.${CLS.error} > span { flex: 1; }
.${CLS.commit} { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 12px; border-top: ${HAIRLINE}; }
.${CLS.commitInput} { box-sizing: border-box; resize: vertical; min-height: 56px; padding: 8px 10px; border-radius: var(--dsw-radius-md, 10px);
  border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit;
  font-size: 13px; line-height: 20px; outline: none; }
.${CLS.commitInput}:focus { border-color: ${ACCENT}; }
.${CLS.commitInput}[readonly] { color: var(--dsw-alias-label-tertiary); }
.${CLS.commitNote} { margin-top: -2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.${CLS.commitNote}[data-tone="warn"] { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); }
.${CLS.commitNote}[data-tone="error"] { color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; word-break: break-word; }
.${CLS.commitRow} { display: flex; gap: 8px; }
.${CLS.commitButton} { flex: 1; height: 30px; border: none; border-radius: var(--dsw-radius-sm, 8px); cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 500; background: ${ACCENT}; color: var(--dsw-alias-label-primary-foreground, #fff); }
.${CLS.commitButton}:hover:not(:disabled) { filter: brightness(1.06); }
.${CLS.commitButton}:disabled { cursor: default; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.${CLS.aiButton} { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px;
  border: none; border-radius: var(--dsw-radius-sm, 8px); background: transparent; box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
.${CLS.aiButton}:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${CLS.aiButton}:disabled { opacity: 0.4; cursor: default; }
.${CLS.aiButton}[aria-busy="true"] { color: ${ACCENT}; }
`

/* The status mark is tinted by kind: amber edits, green additions, red deletions, blue renames; a conflict is solid red. */
const ROWS = `
.${CLS.row} { position: relative; display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 6px); font-size: 12.5px; }
.${CLS.row}:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${CLS.letter} { box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
  border-radius: var(--dsw-radius-xs, 4px); background: var(--${P}-tint); color: var(--${P}-tone);
  font-family: ${MONO}; font-size: 10.5px; font-weight: 600; line-height: 16px; }
.${CLS.path} { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; padding: 0; border: none; background: transparent;
  color: inherit; font: inherit; cursor: pointer; text-align: left; }
.${CLS.name} { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${CLS.dir} { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
  color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.${CLS.stats} { flex: none; display: flex; gap: 4px; font-family: ${MONO}; font-size: 11.5px; line-height: 16px; }
.${CLS.add} { color: var(--dsw-alias-file-diff-added-marker, var(--dsw-alias-state-success-primary)); }
.${CLS.del} { color: var(--dsw-alias-file-diff-deleted-marker, var(--dsw-alias-state-error-primary)); }
.${CLS.rowActions} { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: none; gap: 2px;
  padding-left: 12px; background: linear-gradient(90deg, transparent, var(--dsw-alias-bg-layer-1) 12px); }
.${CLS.row}:hover .${CLS.rowActions}, .${CLS.row}:focus-within .${CLS.rowActions} { display: flex; }
.${CLS.row} { --${P}-tone: var(--dsw-alias-label-secondary); --${P}-tint: var(--dsw-alias-interactive-bg-hover); }
.${CLS.row}[data-status="M"], .${CLS.row}[data-status="T"] {
  --${P}-tone: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
  --${P}-tint: var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-interactive-bg-hover)); }
.${CLS.row}[data-status="A"], .${CLS.row}[data-status="untracked"] {
  --${P}-tone: var(--dsw-alias-state-success-primary);
  --${P}-tint: var(--dsw-alias-state-success-tertiary, var(--dsw-alias-interactive-bg-hover)); }
.${CLS.row}[data-status="R"], .${CLS.row}[data-status="C"] {
  --${P}-tone: var(--dsw-alias-state-business-primary);
  --${P}-tint: var(--dsw-alias-state-business-tertiary, var(--dsw-alias-interactive-bg-hover)); }
.${CLS.row}[data-status="D"] {
  --${P}-tone: var(--dsw-alias-state-error-primary);
  --${P}-tint: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover)); }
.${CLS.row}[data-status="U"] { --${P}-tone: var(--dsw-alias-label-primary-foreground, #fff); --${P}-tint: var(--dsw-alias-state-error-primary); }
.${CLS.row}[data-status="D"] .${CLS.name} { text-decoration: line-through; color: var(--dsw-alias-label-tertiary); }
`

const DIFF = `
.${CLS.diff} { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.${CLS.diffHeader} { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: ${HAIRLINE}; }
.${CLS.diffPath} { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--dsw-font-mono, monospace); font-size: 12px; }
.${CLS.diffSide} { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.${CLS.diffBody} { flex: 1; min-height: 0; overflow: auto; font-family: var(--dsw-font-mono, monospace);
  font-size: 12px; line-height: 18px; }
.${CLS.diffHunk} { padding: 2px 8px; color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-bg-layer-2); }
.${CLS.diffNote} { padding: 4px 8px; color: var(--dsw-alias-label-tertiary); }
.${CLS.diffLine} { display: flex; min-width: max-content; }
.${CLS.diffLine}[data-kind="add"] { background: rgba(34, 197, 94, 0.1); }
.${CLS.diffLine}[data-kind="del"] { background: rgba(239, 68, 68, 0.1); }
.${CLS.diffNumber} { flex: none; width: 36px; padding-right: 6px; text-align: right; user-select: none;
  color: var(--dsw-alias-label-tertiary); }
.${CLS.diffText} { padding: 0 8px; white-space: pre; }
`

export const CHANGES_STYLES = `${LAYOUT}${ROWS}${DIFF}`
