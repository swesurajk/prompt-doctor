/** Styles for the shadow-root UI. Inlined so no web_accessible_resources are needed. */
export const PANEL_CSS = `
:host {
  --pc-bg: #ffffff;
  --pc-fg: #16161a;
  --pc-muted: #6b7280;
  --pc-line: #e8e8ee;
  --pc-accent: #6d5efc;
  --pc-accent-fg: #ffffff;
  --pc-ok: #0f9d64;
  --pc-warn: #d97706;
  --pc-bad: #dc2626;
  --pc-shadow: 0 12px 32px rgba(16, 16, 32, .16), 0 2px 6px rgba(16, 16, 32, .08);
  --pc-radius: 14px;
  all: initial;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
  color: var(--pc-fg);
}
@media (prefers-color-scheme: dark) {
  :host {
    --pc-bg: #1b1b21;
    --pc-fg: #f2f2f5;
    --pc-muted: #9a9aa7;
    --pc-line: #2f2f38;
    --pc-shadow: 0 12px 32px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .3);
  }
}
* { box-sizing: border-box; }

.trigger {
  position: fixed;
  z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  font-size: 12.5px; font-weight: 550; line-height: 1;
  color: var(--pc-fg);
  background: var(--pc-bg);
  border: 1px solid var(--pc-line);
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(16,16,32,.12);
  cursor: pointer;
  opacity: .82;
  transition: opacity .12s, transform .12s, border-color .12s;
}
.trigger:hover { opacity: 1; border-color: var(--pc-accent); transform: translateY(-1px); }
.trigger:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 2px; opacity: 1; }
.trigger[hidden] { display: none; }
.trigger .kbd { color: var(--pc-muted); font-size: 10.5px; font-weight: 450; }
.trigger.busy { pointer-events: none; }
.trigger.busy .spark { animation: pc-pulse .9s ease-in-out infinite; }
@keyframes pc-pulse { 50% { opacity: .35; } }

.panel {
  position: fixed;
  z-index: 2147483001;
  width: min(420px, calc(100vw - 24px));
  max-height: min(70vh, 620px);
  display: flex; flex-direction: column;
  background: var(--pc-bg);
  border: 1px solid var(--pc-line);
  border-radius: var(--pc-radius);
  box-shadow: var(--pc-shadow);
  overflow: hidden;
  font-size: 13px;
}
.panel[hidden] { display: none; }

header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--pc-line);
  flex: 0 0 auto;
}
header .title { font-weight: 600; font-size: 12.5px; letter-spacing: .01em; }
header .sub { color: var(--pc-muted); font-size: 11px; }
header .grow { flex: 1; }
.iconbtn {
  all: unset; cursor: pointer; color: var(--pc-muted);
  width: 22px; height: 22px; border-radius: 6px;
  display: grid; place-items: center; font-size: 14px; line-height: 1;
}
.iconbtn:hover { background: var(--pc-line); color: var(--pc-fg); }
.iconbtn:focus-visible { outline: 2px solid var(--pc-accent); }

.body { padding: 12px; overflow-y: auto; overscroll-behavior: contain; flex: 1 1 auto; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: var(--pc-line); border-radius: 8px; }

footer {
  display: flex; gap: 8px; align-items: center;
  padding: 10px 12px; border-top: 1px solid var(--pc-line); flex: 0 0 auto;
}
footer .grow { flex: 1; }

button.btn {
  all: unset; cursor: pointer;
  padding: 7px 12px; border-radius: 9px;
  font-size: 12.5px; font-weight: 550; line-height: 1.2;
  border: 1px solid var(--pc-line); color: var(--pc-fg);
  white-space: nowrap;
}
button.btn:hover { border-color: var(--pc-muted); }
button.btn:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 1px; }
button.btn.primary { background: var(--pc-accent); color: var(--pc-accent-fg); border-color: transparent; }
button.btn.primary:hover { filter: brightness(1.08); }
button.btn[disabled] { opacity: .5; cursor: default; }

.score { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ring { flex: 0 0 auto; }
.ring text { font: 600 15px ui-sans-serif, sans-serif; fill: var(--pc-fg); }
.score .band { font-weight: 600; font-size: 13.5px; }
.score .intent { color: var(--pc-muted); font-size: 11.5px; margin-top: 2px; line-height: 1.35; }
.tag {
  display: inline-block; padding: 1px 6px; margin-left: 6px;
  border: 1px solid var(--pc-line); border-radius: 5px;
  font-size: 10px; font-weight: 550; color: var(--pc-muted); text-transform: uppercase; letter-spacing: .04em;
}

ul.dims { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
ul.dims li { display: flex; gap: 7px; align-items: flex-start; line-height: 1.4; }
ul.dims .mark { flex: 0 0 13px; font-size: 12px; margin-top: 1px; }
ul.dims .missing .mark { color: var(--pc-bad); }
ul.dims .weak .mark { color: var(--pc-warn); }
ul.dims .ok .mark { color: var(--pc-ok); }
ul.dims .name { font-weight: 550; }
ul.dims .note { color: var(--pc-muted); }
ul.dims .ok .note, ul.dims .ok .name { color: var(--pc-muted); font-weight: 450; }

.section { margin-top: 14px; }
.section h3 {
  margin: 0 0 7px; font-size: 10.5px; font-weight: 650;
  text-transform: uppercase; letter-spacing: .06em; color: var(--pc-muted);
}

.q { border: 1px solid var(--pc-line); border-radius: 10px; padding: 9px 10px; margin-bottom: 8px; }
.q p { margin: 0 0 7px; font-weight: 550; line-height: 1.35; }
.q .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  all: unset; cursor: pointer; padding: 4px 9px; border-radius: 999px;
  border: 1px solid var(--pc-line); font-size: 11.5px;
}
.chip:hover { border-color: var(--pc-accent); }
.chip[aria-pressed="true"] { background: var(--pc-accent); color: var(--pc-accent-fg); border-color: transparent; }
.chip:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 1px; }

textarea.preview {
  width: 100%; min-height: 190px; resize: vertical;
  padding: 10px; border-radius: 10px; border: 1px solid var(--pc-line);
  background: transparent; color: var(--pc-fg);
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
textarea.preview:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: -1px; }

.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.steps li { color: var(--pc-muted); display: flex; gap: 7px; align-items: center; }
.steps li.done { color: var(--pc-fg); }
.steps li .mark { width: 13px; color: var(--pc-ok); }

.notice { padding: 10px 11px; border-radius: 10px; border: 1px solid var(--pc-line); line-height: 1.45; }
.notice.warn { border-color: color-mix(in srgb, var(--pc-warn) 45%, var(--pc-line)); }
.notice.bad { border-color: color-mix(in srgb, var(--pc-bad) 45%, var(--pc-line)); }
.notice h4 { margin: 0 0 4px; font-size: 12.5px; }
.notice code { font: 11.5px ui-monospace, Menlo, monospace; color: var(--pc-muted); }
.muted { color: var(--pc-muted); }
.mode { display: flex; gap: 4px; flex-wrap: wrap; }
select.modesel {
  all: unset; cursor: pointer; font-size: 11.5px; color: var(--pc-muted);
  padding: 3px 6px; border: 1px solid var(--pc-line); border-radius: 7px;
}
`;
