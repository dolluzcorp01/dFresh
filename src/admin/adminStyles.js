// Admin console styles: plain staff layout (not the public design), scoped under .adm so nothing leaks to the site.
// Gold is a fill only (text on it is ink); the sidebar collapses into a menu under 900px.
// Kept as a string that AdminApp puts in a <style> tag: a separate CSS chunk would make webpack add its
// CSS-chunk loader to the public main.js, and the admin must add 0 KB to the public bundle.
const css = `
.adm {
  --a-ink: #121214; --a-ink2: #4a4840; --a-muted: #6b675e; --a-line: #e2dccb; --a-bg: #f6f3ea; --a-card: #fff;
  --a-gold: #e5bf24; --a-bad: #b3261e; --a-ok: #1e6b3a; --a-warn: #8a5a00;
  font: 14px/1.5 'Open Sans', system-ui, sans-serif; color: var(--a-ink); background: var(--a-bg); min-height: 100vh;
  user-select: text; -webkit-user-select: text;
}
.adm * { box-sizing: border-box; }
.adm h1 { font: 700 24px/1.2 Saira, system-ui, sans-serif; margin: 0 0 16px; }
.adm h2 { font-size: 16px; margin: 0 0 10px; }
.adm h3 { font-size: 14px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .06em; color: var(--a-ink2); }
.adm code { font: 12.5px/1.3 ui-monospace, Consolas, monospace; background: #efeadb; padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.adm a { color: var(--a-ink); }
.a-muted { color: var(--a-muted); }
.a-bad { color: var(--a-bad); font-weight: 600; }
.a-center { display: grid; place-items: center; padding: 16px; }

.a-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); grid-template-rows: auto 1fr; }
.a-top { grid-column: 1 / -1; display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: var(--a-ink); color: #fff; }
.a-top strong { font-family: Saira, system-ui, sans-serif; }
.a-top .a-who { margin-inline-start: auto; font-size: 13px; opacity: .85; }
.a-top .a-who code { background: #2a2a2e; color: #fff; }
.a-top .a-btn-ghost { color: #fff; border-color: #55555c; }
.a-burger { display: none; }
.a-nav { display: flex; flex-direction: column; padding: 12px 8px; gap: 2px; border-inline-end: 1px solid var(--a-line); background: #fbf9f3; }
.a-nav a { padding: 8px 12px; border-radius: 8px; text-decoration: none; color: var(--a-ink2); }
.a-nav a:hover { background: #efeadb; }
.a-nav a.active { background: var(--a-gold); color: var(--a-ink); font-weight: 600; }
.a-main { padding: 20px; min-width: 0; }

.a-card { background: var(--a-card); border: 1px solid var(--a-line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.a-login { width: min(380px, 100%); display: grid; gap: 12px; }
.a-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.a-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.a-tile { display: flex; flex-direction: column; background: var(--a-card); border: 1px solid var(--a-line); border-radius: 12px; padding: 14px; text-decoration: none; }
.a-tile-v { font: 700 26px/1.1 Saira, system-ui, sans-serif; }
.a-tile-l { color: var(--a-muted); font-size: 13px; }
.a-tile.a-warn { border-color: var(--a-bad); }

.a-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--a-ink); background: var(--a-ink); color: #fff; font: 600 13.5px/1 inherit; padding: 9px 14px; border-radius: 8px; cursor: pointer; text-decoration: none; }
.a-btn:disabled { opacity: .5; cursor: not-allowed; }
.a-btn-ghost { background: transparent; color: var(--a-ink); border-color: var(--a-line); }
.a-btn-danger { background: var(--a-bad); border-color: var(--a-bad); }
.a-btn-sm { padding: 5px 9px; font-size: 12.5px; }
.a-x { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: inherit; padding: 2px 6px; }
.a-file { position: relative; overflow: hidden; }
.a-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.a-btn:focus-visible, .adm input:focus-visible, .adm select:focus-visible, .adm textarea:focus-visible, .a-nav a:focus-visible, .a-table tr:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 2px; }

.a-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.a-toolbar form { display: contents; }
.a-inline { display: inline-flex; gap: 6px; align-items: center; }
.a-row { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.adm input[type="text"], .adm input[type="search"], .adm input[type="email"], .adm input[type="password"], .adm input[type="number"], .adm input[type="date"], .adm input:not([type]), .adm input[inputmode], .adm select, .adm textarea {
  font: inherit; padding: 7px 9px; border: 1px solid var(--a-line); border-radius: 8px; background: #fff; color: var(--a-ink); max-width: 100%;
}
.adm textarea { width: 100%; resize: vertical; }
.a-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.a-field > span { font-weight: 600; font-size: 13px; }
.a-field input, .a-field select, .a-field textarea { width: 100%; }
.a-check { flex-direction: row; align-items: center; gap: 8px; }
.a-check input { width: auto; }
.a-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.a-wide { grid-column: 1 / -1; }

.a-note { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; padding: 10px 12px; border-radius: 8px; margin: 8px 0; background: #eef3f8; border: 1px solid #c9d8e6; }
.a-note ul { margin: 0; padding-inline-start: 18px; }
.a-note-error { background: #fbeceb; border-color: #e8b4b0; color: #7a1a14; }
.a-note-ok { background: #eaf5ee; border-color: #b5d9c1; color: var(--a-ok); }
.a-note-warn { background: #fdf4e3; border-color: #ecd09a; color: var(--a-warn); }

.a-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.a-table { width: 100%; border-collapse: collapse; background: var(--a-card); }
.a-table th, .a-table td { text-align: start; padding: 7px 9px; border-bottom: 1px solid var(--a-line); vertical-align: top; }
.a-table th { font-size: 12.5px; color: var(--a-ink2); background: #faf8f1; white-space: nowrap; }
.a-hover tbody tr { cursor: pointer; }
.a-hover tbody tr:hover { background: #faf6e6; }
.a-num { text-align: end; font-variant-numeric: tabular-nums; }
.a-off td { color: var(--a-muted); }
.a-thumb { width: 40px; height: 40px; object-fit: contain; background: #fff; border: 1px solid var(--a-line); border-radius: 6px; }
.a-handle { cursor: grab; color: var(--a-muted); }
.a-pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: #efeadb; }
.a-st-new { background: var(--a-gold); }
.a-st-won { background: #cfe8d6; }
.a-st-lost, .a-st-spam { background: #eee; color: var(--a-muted); }
.a-ob-failed { background: #f6d2cf; color: #7a1a14; }
.a-ob-sent, .a-ob-done { background: #cfe8d6; }
.a-ob-cancelled { background: #eee; color: var(--a-muted); }
.a-pager { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.a-grid td { min-width: 200px; }
.a-grid td:first-child { min-width: 180px; max-width: 260px; }
.a-grid .a-group th { background: #efeadb; text-transform: uppercase; letter-spacing: .06em; }
.a-missing, .adm .a-missing textarea, .adm input.a-missing, .adm textarea.a-missing { background: #fdecea; }
.a-diff { max-width: 520px; overflow-wrap: anywhere; font-size: 12.5px; }
.a-diff del { color: var(--a-bad); }
.a-diff ins { color: var(--a-ok); text-decoration: none; }
.a-dl { display: grid; gap: 4px; margin: 0; }
.a-dl div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 8px; }
.a-dl dt { color: var(--a-muted); }
.a-dl dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.a-report h3 { margin-top: 16px; }

.a-tr { display: grid; grid-template-columns: 150px repeat(var(--cols), minmax(180px, 1fr)); gap: 6px; overflow-x: auto; }
.a-tr-head { font-weight: 600; font-size: 12.5px; padding: 4px 0; }
.a-tr-label { font-size: 13px; padding-top: 7px; }
.a-tr input, .a-tr textarea { width: 100%; }

.a-photos { display: flex; flex-wrap: wrap; gap: 12px; }
.a-photos figure { margin: 0; width: 180px; }
.a-photos img { width: 140px; height: 140px; object-fit: contain; background: #fff; border: 1px solid var(--a-line); border-radius: 8px; display: block; }
.a-photos img.a-banner-desktop { width: 180px; height: 75px; object-fit: cover; }
.a-photos img.a-banner-mobile { width: 108px; height: 135px; object-fit: cover; }
.a-photos figcaption { font-size: 12px; display: grid; gap: 4px; margin-top: 4px; }

.a-drawer-wrap { position: fixed; inset: 0; background: rgba(18, 18, 20, .35); display: flex; justify-content: flex-end; z-index: 50; }
.a-drawer { width: min(1100px, 100%); height: 100%; background: var(--a-bg); display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0, 0, 0, .15); }
.a-drawer header, .a-drawer footer { display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--a-line); }
.a-drawer header h2 { margin: 0; flex: 1; font-size: 17px; overflow-wrap: anywhere; }
.a-drawer footer { border-top: 1px solid var(--a-line); border-bottom: 0; flex-wrap: wrap; }
.a-drawer-body { padding: 16px; overflow-y: auto; flex: 1; }

@media (max-width: 900px) {
  .a-shell { grid-template-columns: minmax(0, 1fr); }
  .a-burger { display: inline-flex; background: none; border: 1px solid #55555c; color: #fff; border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer; }
  .a-top .a-who { display: none; }
  .a-top .a-btn-ghost { margin-inline-start: auto; }
  .a-nav { display: none; border-inline-end: 0; border-bottom: 1px solid var(--a-line); }
  .a-nav.open { display: flex; }
  .a-main { padding: 14px; }
  .a-dl div { grid-template-columns: 1fr; gap: 0; }
}
@media (prefers-reduced-motion: reduce) { .adm * { transition: none !important; animation: none !important; } }
`;

export default css;
