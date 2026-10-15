// Admin console styles: plain staff layout (not the public design), scoped under .adm so nothing leaks to the site.
// Gold is a fill only (text on it is ink). Sidebar: ink with gold accents, groups, icon-only when collapsed, a
// slide-in drawer under 900px.
// Kept as a string that AdminApp puts in a <style> tag: a separate CSS chunk would make webpack add its
// CSS-chunk loader to the public main.js, and the admin must add 0 KB to the public bundle.
const css = `
.adm {
  --a-ink: #121214; --a-ink2: #4a4840; --a-muted: #6b675e; --a-line: #e2dccb; --a-bg: #f6f3ea; --a-card: #fff;
  --a-gold: #e5bf24; --a-bad: #b3261e; --a-ok: #1e6b3a; --a-warn: #8a5a00;
  --a-top-h: 56px; /* header bar height: the sidebar sits right below it, window height minus this */
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

.a-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); grid-template-rows: auto 1fr; }
.a-shell.collapsed { grid-template-columns: 64px minmax(0, 1fr); }
/* Header and sidebar stay put while the page scrolls: header sticky at the top, sidebar sticky right below it and
   exactly as tall as the rest of the window, so the ink always reaches the bottom (no cream gap). */
.a-top { grid-column: 1 / -1; position: sticky; top: 0; z-index: 40; height: var(--a-top-h); display: flex; gap: 12px; align-items: center; padding: 0 16px; background: var(--a-ink); color: #fff; }
.a-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; border-radius: 6px; }
.adm .a-brand { color: var(--a-gold); }
.a-brand img { display: block; height: 30px; width: auto; }
.a-brand-tag { font: 600 11px/1 Saira, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; padding: 4px 7px; border: 1px solid #55555c; border-radius: 999px; }
.a-brand:focus-visible { outline: 2px solid var(--a-gold); outline-offset: 3px; }
.a-top .a-who { margin-inline-start: auto; font-size: 13px; opacity: .85; }
.a-top .a-who code { background: #2a2a2e; color: #fff; }
.a-top .a-btn-ghost { color: #fff; border-color: #55555c; }
.a-burger { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 1px solid #3a3a40; border-radius: 8px; background: none; color: #fff; cursor: pointer; }
.a-burger:hover { background: #232327; }
.a-burger:focus-visible { outline: 2px solid var(--a-gold); outline-offset: 2px; }
/* Sidebar: ink, gold accents. Item text #d9d4c6 on ink 13:1, group headings #a9a497 7:1; active = gold fill, ink text. */
.a-nav { --n-ink: #121214; --n-hover: #232327; --n-text: #d9d4c6; --n-head: #a9a497;
  display: flex; flex-direction: column; background: var(--n-ink); color: var(--n-text); border-top: 1px solid #2a2a2e;
  position: sticky; top: var(--a-top-h); align-self: start; overflow: hidden;
  height: calc(100vh - var(--a-top-h)); height: calc(100dvh - var(--a-top-h)); }
/* Only the item list scrolls, with a thin ink scrollbar (never a light one); the toggle under it never moves. */
.a-nav-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 2px;
  padding: 12px 10px 8px; scrollbar-width: thin; scrollbar-color: #3a3a40 transparent; }
.a-nav-list::-webkit-scrollbar { width: 8px; }
.a-nav-list::-webkit-scrollbar-track { background: transparent; }
.a-nav-list::-webkit-scrollbar-thumb { background: #3a3a40; border-radius: 8px; border: 2px solid var(--n-ink); }
.a-nav-list::-webkit-scrollbar-thumb:hover { background: #55555c; }
.a-nav .a-ico { flex: none; }
.adm .a-nav-item { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 8px 10px; border-radius: 8px; text-decoration: none; color: var(--n-text); font-size: 13.5px; }
.adm .a-nav-item:hover { background: var(--n-hover); color: #fff; }
.adm .a-nav-item.active { background: var(--a-gold); color: var(--a-ink); font-weight: 600; }
.a-nav-item .a-lbl { flex: 1; min-width: 0; }
.a-grp { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.a-grp-h { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 6px 10px; border: 0; border-radius: 8px; background: none;
  color: var(--n-head); font: 700 11.5px/1.2 'Open Sans', system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; text-align: start; cursor: pointer; }
.a-grp-h:hover { background: var(--n-hover); color: #fff; }
.a-grp.current > .a-grp-h { color: var(--a-gold); }
.a-grp-h .a-lbl { flex: 1; }
.a-grp-h .a-chev { transition: transform .18s ease; opacity: .8; }
.a-grp-h[aria-expanded="true"] .a-chev { transform: rotate(90deg); }
.a-grp-items { display: flex; flex-direction: column; gap: 2px; padding-inline-start: 8px; }
.a-grp-items[hidden] { display: none; }
.a-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  background: var(--a-gold); color: var(--a-ink); font: 700 11.5px/1 'Open Sans', system-ui, sans-serif; }
.a-nav-item.active .a-badge { background: var(--a-ink); color: var(--a-gold); }
.a-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.a-nav-sep { height: 1px; background: #2f2f34; margin: 10px 6px; flex: none; }
.a-nav-ext .a-ico { opacity: .85; }
.a-collapse { flex: none; margin: 0 10px 10px; display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 8px 10px; border: 0; border-radius: 8px; box-shadow: 0 -1px 0 #2f2f34;
  background: none; color: var(--n-head); font: 600 12.5px/1 'Open Sans', system-ui, sans-serif; cursor: pointer; }
.a-collapse:hover { background: var(--n-hover); color: #fff; }
.a-nav :focus-visible { outline: 2px solid var(--a-gold); outline-offset: 1px; }
/* Collapsed: icons only, names as tooltips (title) and still read by screen readers (.a-lbl visually hidden) */
/* Collapsed: tighter rows so every icon fits without scrolling at 1366 x 768 */
.a-nav.collapsed .a-nav-list { padding: 10px 8px 6px; gap: 1px; align-items: stretch; }
.a-nav.collapsed .a-grp { margin-top: 0; gap: 1px; }
.adm .a-nav.collapsed .a-nav-item, .a-nav.collapsed .a-collapse { justify-content: center; min-height: 30px; padding: 6px 0; position: relative; }
.a-nav.collapsed .a-collapse { margin: 0 8px 8px; }
.a-nav.collapsed .a-nav-sep { margin: 6px 4px; }
.a-nav.collapsed .a-lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.a-nav.collapsed .a-grp-items { padding-inline-start: 0; }
.a-nav.collapsed .a-badge { position: absolute; top: 2px; inset-inline-end: 2px; min-width: 16px; height: 16px; padding: 0 4px; font-size: 10px; }
.a-grp-sep { height: 1px; background: #2f2f34; margin: 5px 6px; }
.a-nav-backdrop { display: none; }
.a-main { padding: 20px; min-width: 0; }

.a-card { background: var(--a-card); border: 1px solid var(--a-line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
/* Sign-in: paper page, beige glow, white card with a gold top rule (gold is a fill; text on it is ink). */
.a-login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
  background: radial-gradient(120% 80% at 50% 0%, #f3ebdb 0%, #fcfbf6 60%); }
.a-login-wrap { width: min(400px, 100%); display: grid; justify-items: center; gap: 18px; }
.a-login-logo { width: 132px; height: auto; display: block; }
.a-login { width: 100%; display: grid; gap: 14px; background: #fff; border: 1px solid var(--a-line); border-top: 4px solid var(--a-gold);
  border-radius: 14px; padding: 26px 24px 22px; box-shadow: 0 10px 30px rgba(18, 18, 20, .06); }
.a-login h1 { margin: 0; font-size: 26px; }
.a-login .a-muted { margin: -6px 0 2px; }
.a-login .a-note { margin: 0; }
.a-login .a-field > label > span { font-weight: 600; font-size: 13px; }
.adm .a-login input { padding: 10px 12px; border-radius: 10px; min-height: 44px; }
.adm .a-login input:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 1px; box-shadow: 0 0 0 5px rgba(229, 191, 36, .45); }
.a-pw { position: relative; }
.adm .a-pw input { padding-inline-end: 48px; }
.a-eye { position: absolute; inset-block: 0; inset-inline-end: 2px; width: 44px; display: grid; place-items: center; border: 0; background: none; color: var(--a-ink2); cursor: pointer; border-radius: 8px; }
.a-eye:hover { color: var(--a-ink); }
.a-eye:focus-visible { outline: 2px solid var(--a-ink); outline-offset: -4px; }
.a-caps { margin: 2px 0 0; min-height: 0; font-size: 12.5px; font-weight: 600; color: var(--a-warn); }
.a-caps:empty { display: none; }
.a-code { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.adm .a-code input { width: 100%; min-width: 0; height: 54px; padding: 0; text-align: center; font: 700 24px/1 Saira, system-ui, sans-serif; border: 1.5px solid var(--a-line); border-radius: 10px; caret-color: var(--a-ink); }
.adm .a-code input.filled { border-color: var(--a-ink2); background: #fffdf4; }
.adm .a-btn-gold { background: var(--a-gold); border-color: var(--a-gold); color: var(--a-ink); }
.adm .a-btn-gold:hover:not(:disabled) { background: #f4cf2c; border-color: #f4cf2c; }
.adm .a-btn-block { width: 100%; justify-content: center; min-height: 46px; font-size: 15px; border-radius: 10px; }
.a-spin { width: 16px; height: 16px; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: a-spin .7s linear infinite; }
@keyframes a-spin { to { transform: rotate(360deg); } }
.a-login-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; }
.a-link { border: 0; background: none; padding: 6px 0; font: 600 13.5px/1.3 inherit; color: var(--a-ink); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.a-link:disabled { color: var(--a-muted); text-decoration: none; cursor: default; }
.a-link:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 2px; }
@media (max-width: 400px) {
  .a-login { padding: 22px 16px 18px; }
  .a-code { gap: 6px; }
  .adm .a-code input { height: 50px; font-size: 22px; }
}
.a-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.a-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.a-tile { display: flex; flex-direction: column; background: var(--a-card); border: 1px solid var(--a-line); border-radius: 12px; padding: 14px; text-decoration: none; }
.a-tile-v { font: 700 26px/1.1 Saira, system-ui, sans-serif; }
.a-tile-l { color: var(--a-muted); font-size: 13px; }
.a-tile.a-warn { border-color: var(--a-bad); }
.a-attn { background: var(--a-card); border: 1px solid var(--a-line); border-inline-start: 4px solid var(--a-gold); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
.a-attn h2 { margin: 0 0 8px; }
.a-attn ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.a-attn li a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; text-decoration: none; }
.a-attn li a:hover { background: #faf6e6; }
.a-attn li a:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 1px; }
.a-attn-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #8a8577; }
.a-attn-bad .a-attn-dot { background: var(--a-bad); }
.a-attn-warn .a-attn-dot { background: #c98a00; }
.a-attn-go { margin-inline-start: auto; flex: none; opacity: .55; }
.a-attn.a-attn-ok { border-inline-start-color: var(--a-ok); }
.a-attn.a-attn-ok p { margin: 0; color: var(--a-ok); }
.a-jump-h { margin-top: 8px; }
.a-jump { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.a-jump-tile { background: var(--a-card); border: 1px solid var(--a-line); border-radius: 12px; padding: 12px 14px; }
.adm .a-jump-title { display: flex; align-items: center; gap: 8px; font: 700 15px/1.2 Saira, system-ui, sans-serif; text-decoration: none; margin-bottom: 6px; }
.a-jump-title .a-ico { color: var(--a-ink2); }
.a-jump ul { margin: 0; padding-inline-start: 26px; display: grid; gap: 2px; font-size: 13.5px; }
tr.a-target td { background: #fff6d6; }

.a-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--a-ink); background: var(--a-ink); color: #fff; font: 600 13.5px/1 inherit; padding: 9px 14px; border-radius: 8px; cursor: pointer; text-decoration: none; }
.a-btn:disabled { opacity: .5; cursor: not-allowed; }
.a-btn-ghost { background: transparent; color: var(--a-ink); border-color: var(--a-line); }
.a-btn-danger { background: var(--a-bad); border-color: var(--a-bad); }
.a-btn-sm { padding: 5px 9px; font-size: 12.5px; }
.a-x { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: inherit; padding: 2px 6px; }
.a-file { position: relative; overflow: hidden; }
.a-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.a-btn:focus-visible, .adm input:focus-visible, .adm select:focus-visible, .adm textarea:focus-visible, .a-table tr:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 2px; }

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
.a-maillogo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
.a-maillogo-head { display: flex; align-items: center; min-width: 118px; height: 34px; padding: 22px 28px; background: #121214; border-bottom: 4px solid #E5BF24; border-radius: 8px 8px 0 0; color: #F4CF2C; font-size: 12px; }
.a-maillogo-head img { display: block; width: 62px; height: 34px; }
.a-note-ok { background: #eaf5ee; border-color: #b5d9c1; color: var(--a-ok); }
.a-note-warn { background: #fdf4e3; border-color: #ecd09a; color: var(--a-warn); }

.a-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.a-table { width: 100%; border-collapse: collapse; background: var(--a-card); }
.a-table th, .a-table td { text-align: start; padding: 7px 9px; border-bottom: 1px solid var(--a-line); vertical-align: top; }
.a-table th { font-size: 12.5px; color: var(--a-ink2); background: #faf8f1; white-space: nowrap; }
.a-hover tbody tr { cursor: pointer; }
.a-hover tbody tr:hover { background: #faf6e6; }
/* a lead that just arrived (live): a short gold highlight that fades; reduced motion: plain highlight, cleared after 4 s */
.a-table tbody tr.a-fresh td { animation: a-fresh 4s ease-out forwards; }
@keyframes a-fresh { 0%, 35% { background: #fff1bf; } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .a-table tbody tr.a-fresh td { background: #fff1bf; } }
/* "N new leads" toast, bottom right; never covers more than its own corner */
.a-toast { position: fixed; z-index: 80; inset-inline-end: 16px; bottom: 16px; display: flex; align-items: center; gap: 6px; padding: 10px 8px 10px 14px; border-radius: 10px;
  background: var(--a-ink); color: #fff; box-shadow: 0 10px 30px rgba(18, 18, 20, .25); font-weight: 600; }
.adm .a-toast a { color: var(--a-gold); text-decoration: none; }
.a-toast .a-x { color: #fff; }
.a-num { text-align: end; font-variant-numeric: tabular-nums; }
.a-off td { color: var(--a-muted); }
.a-thumb { width: 40px; height: 40px; object-fit: contain; background: #fff; border: 1px solid var(--a-line); border-radius: 6px; }
/* Size picker: page hint, product cell, "Selected first" badge, scale field with its live napkin preview */
.a-pagehint { margin: -6px 0 12px; max-width: 80ch; }
.a-prodcell { display: inline-flex; align-items: center; gap: 8px; }
.a-prodcell code { font-size: 11.5px; white-space: nowrap; }
.a-badge { display: inline-block; padding: 2px 9px; border-radius: 999px; background: var(--a-ink); color: #fff; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
.a-scalefield { display: grid; grid-template-columns: minmax(0, 1fr) 64px; gap: 10px; align-items: start; min-width: 0; }
.a-scaleprev { margin: 22px 0 0; display: grid; justify-items: center; gap: 2px; font-size: 11.5px; }
.a-scaleprev-max { position: relative; display: grid; place-items: center; width: 56px; height: 56px; border: 1.5px dashed #b9b2a0; border-radius: 4px; box-sizing: border-box; }
.a-scaleprev-nap { display: block; background: linear-gradient(135deg, #fff, #F5F0E3); box-shadow: inset 0 0 0 1px #e7dfca, 0 4px 8px -4px rgba(120, 90, 0, .35); background-image: linear-gradient(#e7dfca, #e7dfca), linear-gradient(#e7dfca, #e7dfca), linear-gradient(135deg, #fff, #F5F0E3); background-size: 1px 100%, 100% 1px, 100% 100%; background-position: 50% 0, 0 50%, 0 0; background-repeat: no-repeat; transition: width .2s ease, height .2s ease; }
.a-replace-note { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: #fbf3d5; font-size: 13px; }
/* Product pickers (ProductSelect.js): "Photo from product" + preview, the photo dropdown, a kit's product list */
.a-thumb { flex: none; box-sizing: border-box; display: block; } .a-thumb-none { background: repeating-linear-gradient(45deg, #fff 0 4px, #f3efe3 4px 8px); }
.a-repfield { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.a-rep { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 12.5px; line-height: 1.35; }
.a-ps { position: relative; min-width: 0; }
.a-ps-btn { width: 100%; min-height: 36px; box-sizing: border-box; display: grid; grid-template-columns: 32px auto minmax(0, 1fr) 14px; align-items: center; gap: 8px; padding: 2px 8px 2px 4px; border: 1px solid var(--a-line); border-radius: 8px; background: #fff; color: var(--a-ink); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.a-ps-btn > .a-ps-name:first-child { grid-column: 1 / 4; padding-left: 6px; }
.a-ps-btn:disabled { background: #f6f3ea; cursor: default; }
.a-ps-btn:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 2px; }
.a-ps-caret { color: var(--a-muted); font-size: 11px; text-align: right; }
.a-ps-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a-ps code, .a-pick code, .a-chosen code { flex: none; font-size: 11.5px; white-space: nowrap; }
.a-ps-pop { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: max(100%, 340px); max-width: min(480px, calc(100vw - 32px)); box-sizing: border-box; padding: 6px; background: #fff; border: 1px solid var(--a-line); border-radius: 10px; box-shadow: 0 10px 30px rgba(18, 18, 20, .18); }
.a-ps-pop input[type="search"] { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.a-ps-pop ul { list-style: none; margin: 0; padding: 0; max-height: min(320px, 50vh); overflow-y: auto; overscroll-behavior: contain; }
.a-ps-opt { display: grid; grid-template-columns: 32px auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: 44px; box-sizing: border-box; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.a-ps-opt > .a-ps-name:first-child { grid-column: 1 / -1; }
.a-ps-opt .a-ps-name { white-space: normal; }
.a-ps-var { padding-left: 26px; }
.a-ps-active { background: #fbf3d5; }
.a-ps-opt[aria-selected="true"] { font-weight: 700; }
.a-ps-opt.a-off { color: var(--a-muted); }
.a-ps-group { padding: 8px 6px 4px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--a-muted); }
.a-ps-none { padding: 10px 6px; color: var(--a-muted); font-size: 13px; }
@media (max-width: 560px) { .a-ps-pop { width: 100%; max-width: none; } }
/* drawer sections (kits: text per language, Selected, Products) with clear space between them */
.a-dsec { margin-top: 30px; }
.adm .a-dsec h3 { margin: 0 0 6px; }
.a-kitpick-hint { margin: 0 0 10px; font-size: 12.5px; line-height: 1.45; max-width: 70ch; }
.a-kitpick input[type="search"] { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.a-pick-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--a-line); border-radius: 8px; background: #fff; padding: 4px; }
/* one row per product: [checkbox] [photo 40] [ID] [name], vertically centred; the whole row toggles */
.a-pick { display: grid; grid-template-columns: 18px 40px auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1.3; }
.a-pick:hover { background: #fbf8ef; }
.a-pick input[type="checkbox"] { width: 16px; height: 16px; margin: 0; }
.a-pick-name { min-width: 0; overflow-wrap: anywhere; }
.a-pick-var { padding-left: 34px; }
.a-pick.a-off { color: var(--a-muted); }
.a-pick-none { margin: 8px; }
.a-pick-note { margin: 0 0 6px; font-size: 12.5px; }
.a-chosen { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.a-chosen li { display: grid; grid-template-columns: 14px 18px 40px auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 4px 6px; border: 1px solid var(--a-line); border-radius: 8px; background: #fffdf6; font-size: 13px; line-height: 1.3; }
.a-chosen li[draggable="true"] { cursor: grab; }
.a-chosen li:not([draggable="true"]) { grid-template-columns: 18px 40px auto minmax(0, 1fr); }
.a-chosen .a-num { font-weight: 700; }
.a-chosen-name { min-width: 0; overflow-wrap: anywhere; }
.a-chosen-btns { display: flex; gap: 2px; }
.a-chosen-btns .a-btn { min-width: 28px; padding: 2px 6px; }
.a-handle { cursor: grab; color: var(--a-muted); }
.a-dragging, .a-dragging td { opacity: .45; }
/* Products: a small version of the home page's featured ("Most loved") rail */
.a-kicker { margin: 0 0 2px; font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--a-muted); }
.a-featured h2 { margin: 0 0 2px; }
.a-featured > .a-muted { margin: 0 0 10px; }
.a-featured-list { list-style: none; margin: 0; padding: 2px 2px 8px; display: flex; gap: 10px; overflow-x: auto; }
.a-featured-list li { flex: none; width: 128px; display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid var(--a-line); border-radius: 10px; background: #fffdf6; cursor: pointer; font-size: 12.5px; line-height: 1.3; }
.a-featured-list li[draggable="true"] { cursor: grab; }
.a-featured-list li:hover { border-color: var(--a-ink); }
.a-featured-list li:focus-visible { outline: 2px solid var(--a-ink); outline-offset: 2px; }
.a-featured-list li.a-off { color: var(--a-muted); }
.a-featured-list li.a-off img { opacity: .5; }
.a-featured-list code { font-size: 11px; }
.a-feat-photo { position: relative; display: grid; place-items: center; height: 96px; border-radius: 8px; background: #fff; font-size: 11px; }
.a-feat-photo img { width: 96px; height: 96px; object-fit: contain; }
.a-feat-photo .a-num { position: absolute; top: 4px; left: 4px; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 11px; background: var(--a-ink); color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; text-align: center; box-sizing: border-box; }
.a-feat-name { font-weight: 600; overflow-wrap: anywhere; }
.a-swatch-row { display: flex; align-items: center; gap: 8px; }
/* product editor rows (Products.js): 4 / 1 / 2-3 columns, inputs top-aligned so they line up; the switches on one line */
.a-prow { display: grid; gap: 12px; margin-bottom: 12px; grid-template-columns: minmax(0, 1fr); align-items: start; }
.a-prow-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.a-prow-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.a-prow-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.a-prow .a-field > input, .a-prow .a-field > select, .a-swatch-row input[type="text"] { height: 36px; box-sizing: border-box; }
.a-pchecks { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 28px; }
.a-pchecks .a-check { align-items: center; }
@media (max-width: 900px) { .a-prow-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .a-prow-4, .a-prow-3, .a-prow-2 { grid-template-columns: minmax(0, 1fr); } }
/* swatch: the product card's colour dot (22 px, white ring, thin outline so white shows); empty / invalid = dashed */
.a-dot { position: relative; flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1.5px #e6dfcb; cursor: pointer; }
.a-dot.a-dot-empty { background: transparent; border: 1.5px dashed #8a8577; box-shadow: none; }
.a-dot input[type="color"] { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); opacity: 0; cursor: pointer; padding: 0; border: 0; }
.a-dot:focus-within { outline: 2px solid var(--a-ink); outline-offset: 3px; }
.a-swatch-row input { flex: 1; min-width: 0; }
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
.a-tr-help { display: block; font-size: 11.5px; line-height: 1.35; margin-top: 2px; }
.a-tr input, .a-tr textarea { width: 100%; }
.a-tr-over { display: flex; align-items: center; gap: 8px; min-width: 0; } .a-tr-over input { flex: 1; min-width: 0; } .a-tr-over .a-link { flex: none; padding: 4px 0; font-size: 12.5px; white-space: nowrap; }
.a-tr-over input::placeholder { color: #8a8577; opacity: 1; } .a-tr-main { font-size: 12.5px; padding-top: 7px; }

.a-townmap { margin: 12px 0; max-width: 560px; }
.a-townmap svg { display: block; width: 100%; height: auto; overflow: visible; background: #fff; border: 1px solid var(--a-line); border-radius: 8px; }
.a-townmap figcaption { font-size: 12px; margin-top: 4px; }
.a-count { display: block; text-align: end; font-size: 11px; color: var(--a-muted); }
.a-count.a-bad { color: #b42318; }
.a-picture { display: grid; gap: 6px; justify-items: start; }
.a-picture img { display: block; max-width: 100%; height: auto; object-fit: cover; background: #fff; border: 1px solid var(--a-line); border-radius: 8px; }
.a-picture-none { display: grid; place-items: center; width: 240px; max-width: 100%; height: 100px; border: 1px dashed var(--a-line); border-radius: 8px; font-size: 12px; color: var(--a-muted, #666); }
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
  .a-top .a-who { display: none; }
  .a-top .a-btn-ghost { margin-inline-start: auto; }
  .a-shell.collapsed { grid-template-columns: minmax(0, 1fr); }
  /* drawer: full window height (dvh where supported), the same scrolling list and pinned toggle */
  .a-nav { position: fixed; z-index: 60; top: 0; inset-block: 0; inset-inline-start: 0; width: min(300px, 86vw); height: 100vh; height: 100dvh; border-top: 0;
    transform: translateX(-105%); transition: transform .22s ease; box-shadow: 8px 0 30px rgba(0, 0, 0, .35); visibility: hidden; }
  :root[dir="rtl"] .a-nav { transform: translateX(105%); }
  .a-nav.open { transform: none; visibility: visible; }
  .a-nav-backdrop { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(18, 18, 20, .45); }
  .a-nav-list { padding-top: 16px; }
  .a-main { padding: 14px; }
  .a-dl div { grid-template-columns: 1fr; gap: 0; }
}
@media (prefers-reduced-motion: reduce) { .adm * { transition: none !important; animation: none !important; } }
`;

export default css;
