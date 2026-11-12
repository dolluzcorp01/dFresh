// Admin console styles: the v23 back office look (docs/reference/dFresh_Back_Office_v23.html), scoped under .adm so
// nothing leaks to the site. The token block below has the same names and values as v23's :root; every colour, size
// and space of the admin comes from it. Gold is a fill only (text on it is ink).
// Kept as a string that AdminApp puts in a <style> tag: a separate CSS chunk would make webpack add its
// CSS-chunk loader to the public main.js, and the admin must add 0 KB to the public bundle.
const css = `
.adm {
  --brand: #121214; --on-brand: #ffffff;
  --accent: #e5bf24; --accent-soft: #fdf6d8; --accent-line: #efd877;
  --bg: #f5f6f8; --surface: #ffffff; --surface-2: #fafbfc;
  --line: #e6e8ec; --line-2: #d5d9e0;
  --text: #14161a; --text-2: #3b414b; --muted: #6b7280; --faint: #9aa1ac;
  --good: #15803d; --good-bg: #ecfdf3; --good-line: #bbf7d0;
  --bad: #c62828; --bad-bg: #fef2f2; --bad-line: #fecaca;
  --warn: #b45309; --warn-bg: #fffbeb; --warn-line: #fde68a;
  --info: #1d4ed8; --info-bg: #eff6ff; --info-line: #bfdbfe;
  --font: 'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; --font-head: 'Saira', 'Open Sans', system-ui, sans-serif;
  --fs: 15px; --fs-sm: 13px; --fs-xs: 12px; --fs-h1: 26px; --fs-h2: 18px; --fs-h3: 15.5px;
  --r: 10px; --r-sm: 8px; --r-pill: 999px;
  --pad: 16px; --gap: 16px; --row: 52px; --ctl: 40px;
  --side: 268px; --side-mini: 72px; --head: 60px;
  --shadow: 0 1px 2px rgba(16, 24, 40, .05); --shadow-lg: 0 12px 32px rgba(16, 24, 40, .14), 0 2px 6px rgba(16, 24, 40, .06);
  font: 400 var(--fs)/1.5 var(--font); color: var(--text); background: var(--bg); min-height: 100vh; -webkit-font-smoothing: antialiased;
  user-select: text; -webkit-user-select: text;
}
.adm * { box-sizing: border-box; }
.adm button, .adm input, .adm select, .adm textarea { font-family: inherit; color: inherit; }
.adm h1 { font: 700 var(--fs-h1)/1.2 var(--font-head); margin: 0 0 16px; letter-spacing: .1px; }
.adm h2 { font: 700 var(--fs-h2)/1.3 var(--font-head); margin: 0 0 10px; }
.adm h3 { font: 700 12.5px/1.4 var(--font); margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
.adm code { font: 12.5px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--surface-2); border: 1px solid var(--line); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.adm a { color: var(--text); }
.adm :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.a-muted { color: var(--muted); }
.a-bad { color: var(--bad); font-weight: 600; }
.a-center { display: grid; place-items: center; padding: 16px; }
.a-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.a-i { width: 18px; height: 18px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.a-i-sm { width: 15px; height: 15px; } .a-i-lg { width: 22px; height: 22px; }
.a-rot { transform: rotate(180deg); }

/* ---- frame: the left menu, the header, the page (v23 .app / .side / .head / .page) ---- */
.a-shell { display: grid; grid-template-columns: var(--side) minmax(0, 1fr); min-height: 100vh; }
.a-shell.collapsed { grid-template-columns: var(--side-mini) minmax(0, 1fr); }
.a-side { position: sticky; top: 0; height: 100vh; height: 100dvh; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; z-index: 30; min-width: 0; }
.adm .a-brand2 { height: var(--head); display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid var(--line); flex: none; text-decoration: none; color: var(--text); }
.a-logo { width: 34px; height: 34px; border-radius: 9px; background: #121214; display: grid; place-items: center; flex: none; }
.a-logo img { width: 24px; height: 24px; display: block; }
.a-brand2-t b { font: 700 18px var(--font-head); letter-spacing: .2px; display: block; }
.a-brand2-t small { display: block; font-size: 11px; color: var(--muted); margin-top: -3px; }
.a-side-search { padding: 12px 12px 6px; flex: none; }
.a-side-search label { display: flex; align-items: center; gap: 8px; height: 38px; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 0 10px; color: var(--muted); background: var(--surface-2); }
.adm .a-side-search label input { border: 0; outline: 0; box-shadow: none; background: none; flex: 1; min-width: 0; min-height: 0; font-size: 14px; line-height: 1.5; color: var(--text); padding: 1px 2px; border-radius: 0; height: auto; }
.adm .a-side-search input::-webkit-search-cancel-button { display: none; }
.adm kbd { font: 600 11px var(--font); border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 5px; padding: 1px 5px; color: var(--muted); background: var(--surface); }
.a-navlist { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 6px 10px 14px; scrollbar-width: thin; }
.adm .a-ng, .adm .a-nsg, .adm .a-np { display: flex; align-items: center; gap: 11px; width: 100%; border: 0; background: none; cursor: pointer; border-radius: var(--r-sm); text-decoration: none; text-align: start; }
.adm .a-ng { height: 40px; padding: 0 10px; font: 700 12.5px var(--font); letter-spacing: .7px; text-transform: uppercase; color: var(--text-2); margin-top: 2px; }
.adm .a-ng.cur { color: var(--text); }
.adm .a-ng-solo { text-transform: none; letter-spacing: 0; font: 400 14.5px var(--font); }
.adm .a-ng-solo.on { background: var(--accent-soft); font-weight: 600; color: var(--text); box-shadow: inset 3px 0 0 var(--accent); }
.adm .a-nsg { height: 34px; padding: 0 10px; font: 700 11.5px var(--font); letter-spacing: .6px; text-transform: uppercase; color: var(--muted); }
.adm .a-np { min-height: 38px; padding: 7px 10px; font-size: 14.5px; color: var(--text-2); line-height: 1.3; }
.adm .a-np.on { background: var(--accent-soft); color: var(--text); font-weight: 600; box-shadow: inset 3px 0 0 var(--accent); }
.adm .a-ng:hover, .adm .a-nsg:hover, .adm .a-np:hover { background: var(--surface-2); }
.adm .a-np.on:hover { background: var(--accent-soft); }
.a-ng .a-lbl, .a-nsg .a-lbl { flex: 1; min-width: 0; }
.a-np-l { flex: 1; min-width: 0; }
.a-np-where { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
.a-chev { margin-left: auto; color: var(--faint); transition: transform .15s; }
.a-ng[aria-expanded="true"] .a-chev, .a-nsg[aria-expanded="true"] .a-chev { transform: rotate(90deg); }
.a-kids { margin: 2px 0 6px 19px; padding-left: 10px; border-left: 1px solid var(--line); }
.a-nores { padding: 14px 10px; color: var(--muted); font-size: 14px; }
.a-ncount { margin-left: auto; background: var(--accent); color: #121214; border-radius: 999px; font-size: 11.5px; font-weight: 700; min-width: 20px; height: 20px; display: inline-grid; place-items: center; padding: 0 6px; flex: none; }
.a-np .a-ncount + .a-ncount, .a-tg + .a-ncount { margin-left: 4px; }
.a-side-foot { border-top: 1px solid var(--line); padding: 12px; display: flex; align-items: center; gap: 10px; flex: none; }
.a-who2 { min-width: 0; line-height: 1.25; }
.a-who2 b { font-size: 14px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.a-who2 span { font-size: 12px; color: var(--muted); }
/* mini (icons only) */
.a-side.mini .a-brand2-t > *, .a-side.mini .a-lbl, .a-side.mini .a-chev, .a-side.mini .a-ncount, .a-side.mini .a-tg, .a-side.mini .a-who2 { display: none; }
.adm .a-side.mini .a-brand2 { justify-content: center; padding: 0; }
.a-side.mini .a-navlist { padding: 8px; }
.adm .a-side.mini .a-ng { justify-content: center; padding: 0; }
.adm .a-side.mini .a-ng.cur { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.a-side.mini .a-side-foot { justify-content: center; }
.a-nav-backdrop { display: none; }
/* header */
.a-mainwrap { min-width: 0; display: flex; flex-direction: column; }
.a-head { position: sticky; top: 0; z-index: 20; height: var(--head); background: var(--surface); border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; padding: 0 20px; }
.a-head .a-sp { flex: 1; }
.adm .a-iconbtn { width: 38px; height: 38px; border: 0; border-radius: var(--r-sm); display: grid; place-items: center; color: var(--text-2); background: none; cursor: pointer; position: relative; flex: none; padding: 0; text-decoration: none; }
.adm .a-iconbtn:hover { background: var(--surface-2); }
.a-dot2 { position: absolute; top: 6px; right: 6px; min-width: 17px; height: 17px; border-radius: 9px; background: var(--bad); color: #fff; font: 700 10.5px/17px var(--font); text-align: center; padding: 0 4px; border: 2px solid var(--surface); }
.a-hchip { display: flex; align-items: center; gap: 8px; height: 38px; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 0 10px; background: var(--surface); font-size: 14px; color: var(--text-2); white-space: nowrap; }
.adm .a-hchip select { border: 0; outline: 0; box-shadow: none; background: none; font-weight: 600; cursor: pointer; color: var(--text); padding: 0; min-height: 0; font-size: 14px; }
.adm .a-me { display: flex; align-items: center; gap: 10px; padding: 4px 6px 4px 4px; border-radius: var(--r-sm); cursor: pointer; border: 0; background: none; color: var(--text); }
.adm .a-me:hover { background: var(--surface-2); }
.a-me-t { font-size: 12px; line-height: 1.2; text-align: left; }
.adm .a-me .a-avatar-i { font: 700 12px var(--font) !important; background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--text); }
.adm .a-side-foot .a-avatar-i { font: 700 13px var(--font) !important; background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--text); }
.a-me-t b { font-size: 14px; display: block; white-space: nowrap; }
.a-me-t span { font-size: 12px; color: var(--muted); white-space: nowrap; }
.a-dd { position: relative; }
.a-menu { position: absolute; z-index: 85; top: calc(100% + 6px); min-width: 260px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow-lg); padding: 6px; }
.a-menu-right { right: 0; }
.a-menu-h { padding: 8px 10px 6px; font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.a-menu-h code { text-transform: none; }
.a-menu-empty { margin: 0; padding: 6px 10px 10px; font-size: 14px; color: var(--muted); }
.a-menu hr { border: 0; border-top: 1px solid var(--line); margin: 6px 0; }
.adm .a-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 7px; cursor: pointer; font-size: 14.5px; border: 0; background: none; text-align: start; }
.adm .a-menu-item:hover { background: var(--surface-2); }
.adm .a-menu-danger { color: var(--bad); }
.adm .a-note2 { display: flex; gap: 10px; padding: 10px; border-radius: 7px; text-decoration: none; color: var(--text); }
.a-note2:hover { background: var(--surface-2); }
.a-note2-i { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.a-note2 b { font-size: 14px; display: block; }
.a-note2 span span { font-size: 13px; color: var(--muted); }
.a-stat .a-stat-i.a-tone-good { background: var(--good-bg); color: var(--good); } .a-stat .a-stat-i.a-tone-bad { background: var(--bad-bg); color: var(--bad); }
.a-stat .a-stat-i.a-tone-warn { background: var(--warn-bg); color: var(--warn); } .a-stat .a-stat-i.a-tone-info { background: var(--info-bg); color: var(--info); }
.a-stat .a-stat-i.a-tone-gold { background: var(--accent-soft); color: #8a6d00; }
/* page */
.a-main { padding: 28px 32px 48px; min-width: 0; flex: 1; }
.a-crumb { font-size: 13px; color: var(--muted); margin-bottom: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
.a-crumb b { color: var(--text-2); font-weight: 600; }
.a-ph { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
.a-ph-tt { flex: 1; min-width: 240px; }
.adm .a-ph h1 { margin: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.a-ph p { margin: 6px 0 0; color: var(--muted); font-size: 15px; max-width: 760px; }
.a-ph-acts { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.a-rchips { display: flex; flex-wrap: wrap; gap: 6px; margin: -4px 0 16px; }
.a-rchips .a-pill { white-space: normal; height: auto; min-height: 24px; padding: 3px 10px; line-height: 1.35; }
.a-tg { font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; padding: 2px 6px; border-radius: 5px; white-space: nowrap; }
.a-tg-live { background: var(--good-bg); color: var(--good); } .a-tg-up { background: var(--info-bg); color: var(--info); }
.a-tg-new { background: var(--accent-soft); color: #7a5f00; } .a-tg-later { background: #f1f3f5; color: var(--muted); }
.a-np .a-tg { margin-left: auto; }
/* pills (status badges) */
.a-pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: var(--r-pill); font-size: 12.5px; font-weight: 600; border: 1px solid var(--line); white-space: nowrap; background: #f1f3f5; color: #4b5563; vertical-align: middle; }
.a-pill-good { background: var(--good-bg); color: var(--good); border-color: var(--good-line); }
.a-pill-bad { background: var(--bad-bg); color: var(--bad); border-color: var(--bad-line); }
.a-pill-warn { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-line); }
.a-pill-info { background: var(--info-bg); color: var(--info); border-color: var(--info-line); }
.a-pill-gray { background: #f1f3f5; color: #4b5563; border-color: var(--line); }
.a-pill-gold { background: var(--accent-soft); color: #7a5f00; border-color: var(--accent-line); }
/* alerts (inline boxes) */
.a-alert { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-sm); border: 1px solid; font-size: 14.5px; margin: 0 0 14px; }
.a-alert > .a-i { margin-top: 2px; }
.a-alert-tx { flex: 1; min-width: 0; }
.a-alert-tx > b { display: block; }
.a-alert ul { margin: 0; padding-inline-start: 18px; }
.a-alert .a-x { margin: -4px -6px -4px 0; }
.a-alert-good { background: var(--good-bg); border-color: var(--good-line); color: #14532d; }
.a-alert-bad { background: var(--bad-bg); border-color: var(--bad-line); color: #7f1d1d; }
.a-alert-warn { background: var(--warn-bg); border-color: var(--warn-line); color: #78350f; }
.a-alert-info { background: var(--info-bg); border-color: var(--info-line); color: #1e3a8a; }
/* toasts */
.a-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 90; display: flex; flex-direction: column; gap: 10px; width: min(380px, calc(100vw - 32px)); pointer-events: none; }
.a-tst { pointer-events: auto; display: flex; gap: 12px; align-items: flex-start; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid; border-radius: var(--r-sm); padding: 12px 12px 12px 14px; box-shadow: var(--shadow-lg); font-size: 14.5px; animation: a-tin .18s ease-out; }
.a-tst-good { border-left-color: var(--good); } .a-tst-good > .a-i { color: var(--good); }
.a-tst-bad { border-left-color: var(--bad); } .a-tst-bad > .a-i { color: var(--bad); }
.a-tst-warn { border-left-color: var(--warn); } .a-tst-warn > .a-i { color: var(--warn); }
.a-tst-info { border-left-color: var(--info); } .a-tst-info > .a-i { color: var(--info); }
.a-tst-tx { flex: 1; min-width: 0; overflow-wrap: anywhere; } .a-tst-tx b { display: block; } .a-tst-tx span { color: var(--text-2); }
.adm .a-tst .a-iconbtn-28 { width: 28px; height: 28px; color: var(--muted); }
@keyframes a-tin { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
/* cards, empty state, key / value lists */
.a-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); padding: 20px; margin-bottom: var(--gap); }
.a-card-flush { padding: 0; }
.a-empty { text-align: center; padding: 56px 20px; color: var(--muted); }
.a-empty-ic { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%; background: var(--surface-2); display: grid; place-items: center; color: var(--faint); }
.adm .a-empty h3 { margin: 0 0 6px; color: var(--text); font: 600 16px var(--font); text-transform: none; letter-spacing: 0; }
.a-empty p { margin: 0 0 14px; }
.a-empty-acts { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.a-kv { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; font-size: 14.5px; margin: 0; }
.a-kv dt { color: var(--muted); } .a-kv dd { margin: 0; font-weight: 600; }
.a-ph-kv { border-top: 1px solid var(--line); padding-top: 18px; max-width: 900px; margin: 0 auto; }
.a-ph-kv dd { font-weight: 400; }
/* approval card */
.a-rqc { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 14px; margin-bottom: 10px; background: var(--surface); }
.a-rqc.mine { border-left: 3px solid var(--accent); }
.a-rqc-top { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.a-rqc-amt { margin-left: auto; font: 700 16px var(--font-head); white-space: nowrap; }
.a-rqc-sum { margin: 8px 0 4px; font-weight: 600; }
.a-rqc-by { margin: 0; font-size: 13.5px; }
.a-ladder { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); margin-top: 8px; }
.a-ladder-who { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--text); background: var(--surface-2); }
.a-ladder-who.next { border-color: var(--accent-line); background: var(--accent-soft); font-weight: 600; }
.a-ladder-why { flex-basis: 100%; font-size: 12.5px; }
.a-rqc-split { margin: 6px 0 0; }
/* phase 12b: an override of a rule change (reason box, or the waiting one with its countdown), Send again */
.a-rqc-ovr { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--warn-line); border-radius: var(--r-sm); background: var(--warn-bg); display: grid; gap: 6px; }
.a-rqc-ovr p { margin: 0; }
.a-rqc-ovr .a-racts { margin-top: 0; }
.a-rqc-short { color: var(--bad); }
.a-rqc-ovrdone { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.a-rqc-again { margin-right: auto; align-self: center; }
/* Staff panel: the godowns a person works at (phase 12a) */
.adm .a-rules input.a-ruleval { width: 12ch; text-align: right; }
.a-chkgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 16px; }
.a-racts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; flex-wrap: wrap; }
.a-rqc-decide { margin-top: 10px; }
.a-fld { display: flex; flex-direction: column; gap: 6px; }
.a-fld-l { font-size: 13.5px; font-weight: 600; color: var(--text-2); }
/* Sign-in: paper page, beige glow, white card with a gold top rule (gold is a fill; text on it is ink). */
.a-login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
  background: radial-gradient(120% 80% at 50% 0%, #f3ebdb 0%, #fcfbf6 60%); }
.a-login-wrap { width: min(400px, 100%); display: grid; justify-items: center; gap: 18px; }
.a-login-logo { width: 132px; height: auto; display: block; }
.a-login { width: 100%; display: grid; gap: 14px; background: #fff; border: 1px solid var(--line); border-top: 4px solid var(--accent);
  border-radius: 14px; padding: 26px 24px 22px; box-shadow: 0 10px 30px rgba(18, 18, 20, .06); }
.a-login h1 { margin: 0; font-size: 26px; }
.a-login .a-muted { margin: -6px 0 2px; }
.a-login .a-note { margin: 0; }
.a-login .a-field > label > span { font-weight: 600; font-size: 13px; }
.adm .a-login input { padding: 10px 12px; border-radius: 10px; min-height: 44px; }
.adm .a-login input:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; box-shadow: 0 0 0 5px rgba(229, 191, 36, .45); }
.a-pw { position: relative; }
.adm .a-pw input { padding-inline-end: 48px; }
.a-eye { position: absolute; inset-block: 0; inset-inline-end: 2px; width: 44px; display: grid; place-items: center; border: 0; background: none; color: var(--text-2); cursor: pointer; border-radius: 8px; }
.a-eye:hover { color: var(--text); }
.a-eye:focus-visible { outline: 2px solid var(--text); outline-offset: -4px; }
.a-caps { margin: 2px 0 0; min-height: 0; font-size: 12.5px; font-weight: 600; color: var(--warn); }
.a-caps:empty { display: none; }
.a-code { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
.adm .a-code input { width: 100%; min-width: 0; height: 54px; padding: 0; text-align: center; font: 700 24px/1 Saira, system-ui, sans-serif; border: 1.5px solid var(--line); border-radius: 10px; caret-color: var(--text); }
.adm .a-code input.filled { border-color: var(--text-2); background: #fffdf4; }
.adm .a-btn-gold { background: var(--accent); border-color: var(--accent); color: var(--text); }
.adm .a-btn-gold:hover:not(:disabled) { background: #f4cf2c; border-color: #f4cf2c; }
.adm .a-btn-block { width: 100%; justify-content: center; min-height: 46px; font-size: 15px; border-radius: 10px; }
.a-spin { width: 16px; height: 16px; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: a-spin .7s linear infinite; }
@keyframes a-spin { to { transform: rotate(360deg); } }
.a-login-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; }
.a-link { border: 0; background: none; padding: 6px 0; font-family: inherit; font-weight: 600; font-size: 13.5px; line-height: 1.3; color: var(--text); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.a-link:disabled { color: var(--muted); text-decoration: none; cursor: default; }
.a-link:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
@media (max-width: 400px) {
  .a-login { padding: 22px 16px 18px; }
  .a-code { gap: 6px; }
  .adm .a-code input { height: 50px; font-size: 22px; }
}
.a-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.a-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--gap); margin-bottom: var(--gap); }
.a-tile { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); padding: 18px 20px; text-decoration: none; }
.a-tile-v { font: 700 26px/1.2 var(--font-head); margin-top: 4px; }
.a-tile-l { order: -1; color: var(--muted); font-size: 13px; font-weight: 600; }
.a-tile.a-warn { border-color: var(--bad-line); background: var(--bad-bg); }
.a-attn { background: var(--surface); border: 1px solid var(--line); border-inline-start: 4px solid var(--accent); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
.a-attn h2 { margin: 0 0 8px; }
.a-attn ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.a-attn li a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; text-decoration: none; }
.a-attn li a:hover { background: #faf6e6; }
.a-attn li a:focus-visible { outline: 2px solid var(--text); outline-offset: 1px; }
.a-attn-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #8a8577; }
.a-attn-bad .a-attn-dot { background: var(--bad); }
.a-attn-warn .a-attn-dot { background: #c98a00; }
.a-attn-go { margin-inline-start: auto; flex: none; opacity: .55; }
.a-attn.a-attn-ok { border-inline-start-color: var(--good); }
.a-attn.a-attn-ok p { margin: 0; color: var(--good); }
.a-jump-h { margin-top: 8px; }
.a-jump { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.a-jump-tile { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.adm .a-jump-title { display: flex; align-items: center; gap: 8px; font: 700 15px/1.2 Saira, system-ui, sans-serif; text-decoration: none; margin-bottom: 6px; }
.a-jump-title .a-ico { color: var(--text-2); }
.a-jump ul { margin: 0; padding-inline-start: 26px; display: grid; gap: 2px; font-size: 13.5px; }
tr.a-target td, tbody.a-target td, tbody.a-target th { background: var(--accent-soft); }
div.a-target { box-shadow: 0 0 0 3px var(--accent-line); border-radius: var(--r); }

/* buttons (v23 .btn): primary = ink, ghost = white outline, danger = red, gold = accent; 40 px (sm 32 px) */
.adm .a-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: var(--ctl); padding: 0 16px; border-radius: var(--r-sm); border: 1px solid var(--brand); background: var(--brand); color: var(--on-brand); font-family: var(--font); font-weight: 600; font-size: 14.5px; line-height: 1.5; cursor: pointer; text-decoration: none; text-align: center; white-space: nowrap; max-width: 100%; }
.adm .a-btn:hover:not(:disabled) { filter: brightness(1.12); }
.adm .a-btn:disabled, .adm .a-btn:disabled:hover { opacity: .45; cursor: not-allowed; filter: none; }
.adm .a-btn-ghost { background: var(--surface); color: var(--text); border-color: var(--line-2); }
.adm .a-btn-ghost:hover:not(:disabled) { background: var(--surface-2); filter: none; }
.adm .a-btn-danger { background: var(--bad); border-color: var(--bad); color: #fff; }
.adm .a-btn-sm { height: 32px; padding: 0 11px; font-size: 13.5px; }
/* file choosers: the button part looks like a secondary (outline) button, the file name in muted text */
.adm input[type="file"] { font-family: inherit; font-size: 13px; color: var(--text-2); max-width: 100%; }
.adm input[type="file"]::file-selector-button { font-family: inherit; font-weight: 600; font-size: 13.5px; line-height: 17px; padding: 9px 14px; margin-inline-end: 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; }
.adm input[type="file"]:hover::file-selector-button { border-color: var(--text); }
.adm input[type="file"]:disabled::file-selector-button { opacity: .5; cursor: not-allowed; }
.a-x { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: inherit; padding: 2px 6px; }
.a-file { position: relative; overflow: hidden; }
.a-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.a-btn:focus-visible, .adm input:focus-visible, .adm select:focus-visible, .adm textarea:focus-visible, .a-table tr:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

.a-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.a-toolbar form { display: contents; }
.a-inline { display: inline-flex; gap: 6px; align-items: center; }
.a-row { display: inline-flex; flex-wrap: wrap; gap: 6px; }
/* inputs (v23 .fld): 40 px, line-2 border, 8 px radius; focus = dark border + gold ring */
.adm input[type="text"], .adm input[type="search"], .adm input[type="email"], .adm input[type="password"], .adm input[type="number"], .adm input[type="date"], .adm input[type="tel"], .adm input:not([type]), .adm input[inputmode], .adm select, .adm textarea {
  font: inherit; font-size: var(--fs); line-height: 1.5; min-height: var(--ctl); padding: 7px 12px; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--surface); color: var(--text); max-width: 100%; outline: 0;
}
.adm input:focus, .adm select:focus, .adm textarea:focus { border-color: var(--text-2); box-shadow: 0 0 0 3px rgba(229, 191, 36, .25); }
.adm textarea { width: 100%; resize: vertical; padding: 10px 12px; }
.adm input[type="checkbox"], .adm input[type="radio"] { width: 17px; height: 17px; accent-color: var(--brand); cursor: pointer; }
.a-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.a-field > span { font-weight: 600; font-size: 13.5px; color: var(--text-2); }
.a-req { color: var(--bad); }
.a-hint { font-size: 12.5px; color: var(--muted); }
.a-emsg { font-size: 12.5px; color: var(--bad); font-weight: 600; }
.adm .a-err input, .adm .a-err select, .adm .a-err textarea { border-color: var(--bad); box-shadow: 0 0 0 3px rgba(198, 40, 40, .12); }
.a-field input, .a-field select, .a-field textarea { width: 100%; }
/* read only (a value from the server or the code, or a view-only role): greyed as v23 .numin:disabled */
.a-field input:disabled, .a-field select:disabled, .a-field textarea:disabled { background: var(--surface-2); color: var(--muted); }
.a-check { flex-direction: row; align-items: center; gap: 8px; }
.a-check input { width: auto; }
.a-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px 18px; }
.a-wide { grid-column: 1 / -1; }

.a-note { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-sm); margin: 0 0 14px; background: var(--info-bg); border: 1px solid var(--info-line); color: #1e3a8a; font-size: 14.5px; }
.a-note ul { margin: 0; padding-inline-start: 18px; }
.a-note-error { background: var(--bad-bg); border-color: var(--bad-line); color: #7f1d1d; }
.a-maillogo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; }
.a-maillogo-head { display: flex; align-items: center; min-width: 118px; height: 34px; padding: 22px 28px; background: #121214; border-bottom: 4px solid #E5BF24; border-radius: 8px 8px 0 0; color: #F4CF2C; font-size: 12px; }
.a-maillogo-head img { display: block; width: 62px; height: 34px; }
.a-note-ok { background: var(--good-bg); border-color: var(--good-line); color: #14532d; }
.a-note-warn { background: var(--warn-bg); border-color: var(--warn-line); color: #78350f; }

.a-outbox td:nth-child(2) { overflow-wrap: anywhere; min-width: 120px; }
/* tables (v23 .t): 44 px head (uppercase, muted), 52 px rows, numbers right; the box around a table is the card */
.a-table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 14.5px; }
.a-table th, .a-table td { text-align: start; padding: 0 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.a-table td { height: var(--row); }
.a-table th { height: 44px; font-size: 12.5px; font-weight: 700; color: var(--muted); letter-spacing: .3px; text-transform: uppercase; background: var(--surface-2); white-space: nowrap; }
.a-table tbody tr:last-child td { border-bottom: 0; }
.a-table td.a-num, .a-table th.a-num, .a-table code { white-space: nowrap; }
.adm .a-table code { overflow-wrap: normal; }
.a-hover tbody tr { cursor: pointer; }
.a-hover tbody tr:hover { background: var(--surface-2); }
.adm .a-table input:not([type="checkbox"]):not([type="radio"]), .adm .a-table select { min-height: 34px; padding: 4px 8px; font-size: 14.5px; }
.a-table .a-sort { border: 0; background: none; padding: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; }
.a-tw, .a-scroll { position: relative; overflow-x: auto; -webkit-overflow-scrolling: touch; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); margin-bottom: var(--gap); }
/* sticky head: on desktop the table box scrolls inside the window, so its head stays in view */
@media (min-width: 901px) {
  .a-tw { overflow: auto; max-height: calc(100vh - var(--head) - 48px); }
  .a-tw .a-table thead th { position: sticky; top: 0; z-index: 1; }
}
/* a lead that just arrived (live): a short gold highlight that fades; reduced motion: plain highlight, cleared after 4 s */
.a-table tbody tr.a-fresh td { animation: a-fresh 4s ease-out forwards; }
@keyframes a-fresh { 0%, 35% { background: #fff1bf; } 100% { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .a-table tbody tr.a-fresh td { background: #fff1bf; } }
/* "N new leads" toast, bottom right; never covers more than its own corner */
.a-toast { position: fixed; z-index: 90; right: 20px; bottom: 20px; display: flex; align-items: center; gap: 10px; max-width: min(380px, calc(100vw - 32px)); padding: 12px 10px 12px 14px;
  background: var(--surface); color: var(--text); border: 1px solid var(--line); border-left: 4px solid var(--info); border-radius: var(--r-sm); box-shadow: var(--shadow-lg); font-weight: 600; font-size: 14.5px; animation: a-tin .18s ease-out; }
.adm .a-toast a { color: var(--text); }
.a-toast .a-x { color: var(--muted); }
.a-num, .a-table .a-num { text-align: end; font-variant-numeric: tabular-nums; }
.a-off td { color: var(--muted); }
.a-thumb { width: 40px; height: 40px; object-fit: contain; background: #fff; border: 1px solid var(--line); border-radius: 6px; }
/* Unsaved drag order (useOrderDraft.js): sticky bar at the bottom, "Order saved" toast, the save-or-discard question */
.a-orderbar { position: sticky; bottom: 12px; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 16px; padding: 12px 16px; background: #fff; border: 1px solid var(--text); border-radius: 12px; box-shadow: 0 10px 30px rgba(18, 18, 20, .18); }
.a-orderbar-btns { display: flex; gap: 8px; margin-inline-start: auto; }
.a-ask-wrap { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 16px; background: rgba(18, 18, 20, .35); }
.a-ask { width: min(440px, 100%); padding: 20px; background: #fff; border-radius: 12px; box-shadow: 0 20px 50px rgba(18, 18, 20, .3); }
.a-ask p { margin: 0 0 16px; font-weight: 600; font-size: 15px; }
.a-ask .a-row { gap: 8px; align-items: center; }
/* Banners: photo thumbnail in the list (16:9), Button opens / headline previews */
.a-ctaprev { margin: 0; font-size: 13px; }
.a-dsec .a-ctaprev { margin-top: 8px; }
/* Banners: Desktop / Mobile switches, drawer row 2 (note cols 1-3, target col 4), list thumbs + photo warning */
.a-seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: var(--r-sm); overflow: hidden; background: var(--surface); }
.a-seg button { border: 0; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600; line-height: 1.2; min-height: calc(var(--ctl) - 2px); padding: 0 14px; color: var(--text-2); cursor: pointer; }
.a-seg button + button { border-inline-start: 1px solid var(--line-2); }
.a-seg button[aria-pressed="true"], .a-seg button[aria-selected="true"] { background: var(--brand); color: var(--on-brand); }
.a-seg button small { font-weight: 400; opacity: .75; margin-inline-start: 4px; }
.a-seg button:focus-visible { outline: 2px solid var(--text); outline-offset: -3px; }
.a-banrow2 .a-banote { grid-column: 1 / 4; min-width: 0; }
.a-banrow2.a-notarget .a-banote { grid-column: 1 / -1; }
.a-banote .a-field > input { width: 100%; }
@media (max-width: 900px) { .a-banrow2 .a-banote { grid-column: 1 / -1; } }
.a-bthumbcell { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.a-bthumb { display: block; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); box-sizing: border-box; }
.a-bthumb-desktop { width: 96px; height: 54px; }
.a-bthumb-mobile { width: 43px; height: 54px; }

.a-photobtn { display: block; padding: 0; border: 0; background: none; cursor: zoom-in; border-radius: 6px; }
.a-photobtn:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }

/* Banner preview (lightbox): the site's slide caption, scaled to the frame with container units (cqw); headline in
   Saira, or the language's own font first when it differs from the default language's (as the site). Desktop =
   the site at 1920 wide (text column starts at 404px, max 560px; headline 60px), mobile = the site at 390 wide. */
.a-bp-wrap { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; padding: 16px; background: rgba(18, 18, 20, .6); }
.a-bp-box { max-width: 100%; max-height: 100%; overflow: auto; padding: 14px; background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); box-sizing: border-box; }
.a-bp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.a-bp-bar .a-x { margin-inline-start: auto; }
.a-bp-note { font-size: 12.5px; }
.a-bp { position: relative; container-type: inline-size; overflow: hidden; border-radius: 8px; background: #eee; margin-inline: auto; }
.a-bp-desktop { width: min(1100px, calc(100vw - 64px)); aspect-ratio: 1920 / 800; }
.a-bp-mobile { width: min(380px, calc(100vw - 64px), calc((100vh - 150px) * .8)); aspect-ratio: 1080 / 1350; }
.a-bp > img, .a-bp-none { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center; }
.a-bp-cap { position: absolute; inset: 0; display: flex; align-items: center; padding-inline-start: 21.04cqw; }
.a-bp-ci { position: relative; isolation: isolate; max-width: 29.17cqw; }
.a-bp-k { margin: 0; font: 600 .651cqw/1 var(--bp-font), "Open Sans", sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #121214; }
.a-bp h2 { margin: .625cqw 0 1.25cqw; font-family: var(--bp-disp), sans-serif; font-weight: 800; font-size: 3.125cqw; line-height: 1.02; letter-spacing: -.03em; color: #121214; }
.a-bp-btn { display: inline-flex; align-items: center; gap: .52cqw; padding: .833cqw 1.25cqw; border-radius: 999px; font: 600 .78cqw/1 var(--bp-font), "Open Sans", sans-serif; background: #121214; color: #F4CF2C; white-space: nowrap; }
.a-bp-long .a-bp-k { letter-spacing: .04em; font-size: .703cqw; }
.a-bp-long h2 { font-size: 2.1875cqw; line-height: 1.25; letter-spacing: 0; }
.a-bp-dark h2 { color: #FCFBF6; }
.a-bp-dark .a-bp-k { color: #C9C3B2; }
.a-bp-dark .a-bp-k, .a-bp-dark h2 { text-shadow: 0 1px 2px rgba(0, 0, 0, .35), 0 2px 18px rgba(0, 0, 0, .45); }
.a-bp-dark .a-bp-ci::before { content: ""; position: absolute; inset: -24% -20%; z-index: -1; background: radial-gradient(closest-side, rgba(10, 10, 12, .56), rgba(10, 10, 12, .38) 55%, rgba(10, 10, 12, 0)); }
.a-bp-dark .a-bp-btn { background: #E5BF24; color: #121214; box-shadow: 0 8px 24px -8px rgba(0, 0, 0, .7), 0 0 0 1px rgba(0, 0, 0, .18); }
/* mobile: the site at 390 px (caption at the top, centred, 16 px sides) */
.a-bp-mobile .a-bp-cap { align-items: flex-start; padding: 9cqw 4.1cqw 0; }
.a-bp-mobile .a-bp-ci { max-width: 100%; margin-inline: auto; text-align: center; }
.a-bp-mobile .a-bp-k { font-size: 3.205cqw; }
.a-bp-mobile h2 { font-size: 7.4cqw; margin: 2.56cqw 0 4.6cqw; }
.a-bp-mobile .a-bp-btn { font-size: 3.85cqw; padding: 4.1cqw 6.15cqw; gap: 2.56cqw; }
.a-bp-mobile.a-bp-long .a-bp-k { font-size: 3.46cqw; }
.a-bp-mobile.a-bp-long h2 { font-size: 6.15cqw; }
/* (i) tooltips next to labels (InfoTip): hints stay at most 2 lines, the detail shows on hover / focus */
.a-info { position: relative; display: inline-grid; place-items: center; flex: none; width: 17px; height: 17px; margin-inline-start: 6px; border-radius: 50%; border: 1px solid var(--line-2); background: var(--surface); color: var(--muted); font: 700 10.5px/1 var(--font); text-transform: none; letter-spacing: 0; vertical-align: 1px; cursor: pointer; }
.a-info:hover, .a-info[aria-expanded="true"] { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.a-tip { position: fixed; z-index: 120; width: max-content; padding: 10px 12px; border-radius: var(--r-sm); background: var(--brand); color: var(--on-brand); font: 400 13.5px/1.45 var(--font); white-space: pre-line; text-align: start; text-transform: none; letter-spacing: 0; box-shadow: var(--shadow-lg); }
/* missing translations: amber badge in the name cell, filter chip above lists */
.a-trmiss { margin-inline-start: 6px; cursor: help; }
.a-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--surface); font-family: inherit; font-size: 13.5px; font-weight: 600; line-height: 1.2; min-height: 32px; padding: 4px 12px; color: var(--text-2); cursor: pointer; }
.a-chip[aria-pressed="true"], .a-chip.on { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.a-chip:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-chip b { font-weight: 700; }
/* Form options: group header says where the list is used; "New list" link under the List field */
/* option list header / drawer hint: one line, the path dark, the list key dim, (i) with every place */
.a-placeline { display: flex; align-items: center; gap: 10px; min-width: 0; text-transform: none; letter-spacing: 0; white-space: nowrap; }
.a-place { color: var(--text); font-size: 13px; font-weight: 600; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; }
.a-placekey { flex: none; font-size: 12px; font-weight: 400; font-family: ui-monospace, Consolas, monospace; }
.a-placeline .a-info { flex: none; margin-inline-start: 0; }
@media (max-width: 700px) { .a-placeline { white-space: normal; flex-wrap: wrap; gap: 4px 10px; } }
tr.a-group th:has(.a-placeline) { height: 36px; box-sizing: border-box; } /* same height as a normal row */
.a-placeshint { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.a-fieldplus { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.a-fieldplus .a-link { align-self: flex-start; padding: 2px 0; font-size: 12.5px; }
/* Towns: the edited pin and name can be dragged on the preview map */
.a-townmap svg { touch-action: none; }
.a-tp-cur circle, .a-tp-cur text { cursor: grab; }
.a-tp-dragging, .a-tp-dragging .a-tp-cur circle, .a-tp-dragging .a-tp-cur text { cursor: grabbing; }
/* Towns: map + its fields side by side (fractions, nothing fixed: the map scales to its column), the fields below the
   map when the drawer is narrower (window under 1200px) */
.a-townmapsec { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.a-townmapsec .a-townmap { margin: 0; }
.a-townside .a-prow:last-child { margin-bottom: 0; }
@media (max-width: 1199px) { .a-townmapsec { grid-template-columns: minmax(0, 1fr); } }
/* Translations: help list, the tools card; Languages: how-to card */
.a-trtools .a-trmissing { margin: 0 0 10px; }
.a-trtools .a-toolbar:last-child { margin-bottom: 0; }
/* Info / help card (InfoCard): one style on every page, the light-blue info look */
.a-infocard { margin: 0 0 18px; padding: 12px 14px; border: 1px solid var(--info-line); border-radius: var(--r-sm); background: var(--info-bg); color: #1e3a8a; font-size: 14px; line-height: 1.5; }
.adm .a-infocard-h { margin: 0 0 6px; font: 700 14.5px/1.4 var(--font); }
.a-infocard-b ul, .a-infocard-b ol { margin: 0; padding-inline-start: 20px; }
.a-infocard-b li { margin: 2px 0; }
.a-infocard-b p { margin: 6px 0 0; }
/* Admin users: avatar, person cell, status badge, add form with the employee picker */
.a-avatar { display: inline-block; flex: none; border-radius: 50%; object-fit: cover; }
.a-avatar-i { display: inline-grid; place-items: center; background: #e9e3d2; color: var(--text-2); font-weight: 700; }
.a-person { display: inline-flex; align-items: center; gap: 10px; }
.a-person-sub { display: block; font-size: 12px; }
.a-leftbadge { margin-inline-start: 8px; background: #8a6a0c; }
/* every status badge of the screens is a v23 pill: gray by default, then its tone */
.a-status, .a-ostatus, .a-rstatus, .a-pay, .a-overdue, .a-trmiss, .a-miss, .a-unsaved, .a-tag, .a-warnbadge { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: var(--r-pill); font-size: 12.5px; font-weight: 600; line-height: 1.5; border: 1px solid var(--line); background: #f1f3f5; color: #4b5563; white-space: nowrap; vertical-align: middle; text-decoration: none; }
.a-status-on, .a-ostatus-delivered, .a-rstatus-refunded, .a-rstatus-replaced, .a-pay-paid, .a-ap-approved, .a-st-won, .a-ob-sent, .a-ob-done { background: var(--good-bg); color: var(--good); border-color: var(--good-line); }
.a-status-bad, .a-ostatus-failed, .a-rstatus-rejected, .a-pay-unpaid, .a-ap-rejected, .a-ob-failed, .a-overdue, .a-miss, .a-warnbadge { background: var(--bad-bg); color: var(--bad); border-color: var(--bad-line); }
.a-status-test, .a-ostatus-approval, .a-rstatus-requested, .a-pay-partly_paid, .a-ap-pending, .a-trmiss, .a-unsaved { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-line); }
.a-status-pub, .a-ostatus-new, .a-ostatus-out_for_delivery, .a-ostatus-with_courier, .a-ostatus-dispatched, .a-rstatus-collecting, .a-rstatus-received, .a-rstatus-inspected, .a-pay-part_refunded { background: var(--info-bg); color: var(--info); border-color: var(--info-line); }
.a-ostatus-packing, .a-ostatus-packed, .a-st-new { background: var(--accent-soft); color: #7a5f00; border-color: var(--accent-line); }
.a-status-off, .a-ostatus-cancelled, .a-rstatus-closed, .a-pay-refunded, .a-ap-expired, .a-ap-withdrawn, .a-st-lost, .a-st-spam, .a-ob-cancelled { background: #f1f3f5; color: #4b5563; border-color: var(--line); }
.a-ostatus-cancelled { text-decoration: line-through; }
.a-adduser h2 { margin: 0 0 10px; font-size: 15px; }
.a-adduser-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.a-adduser-btn { margin-top: 24px; }
@media (max-width: 700px) { .a-adduser-row { grid-template-columns: minmax(0, 1fr); } .a-adduser-btn { margin-top: 0; justify-self: start; } }
.a-emppick { position: relative; min-width: 0; }
.a-emppick input { width: 100%; box-sizing: border-box; }
.a-emppick-chosen { display: flex; align-items: center; gap: 10px; min-height: 37px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.a-emppick-chosen .a-link { margin-inline-start: auto; }
.a-emppick-list { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0; max-height: 320px; overflow-y: auto; list-style: none; margin: 0; padding: 4px; background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(18, 18, 20, .18); }
.a-emppick-list li[role="option"] { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer; min-height: 44px; box-sizing: border-box; }
.a-emppick-text { min-width: 0; }
/* In-app confirmation dialog (ConfirmDialog) and pending edits */
.a-cd-wrap { position: fixed; inset: 0; z-index: 110; display: grid; place-items: center; padding: 16px; background: rgba(16, 18, 22, .45); }
.a-cd { width: min(460px, 100%); background: var(--surface); border-radius: 12px; box-shadow: var(--shadow-lg); }
.a-cd-mb { padding: 22px 22px 8px; display: flex; gap: 14px; }
.a-cd-mi { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.a-cd-txt { flex: 1; min-width: 0; }
.adm .a-cd h2 { margin: 2px 0 6px; font: 700 17px/1.3 var(--font-head); }
.a-cd p { margin: 0; color: var(--text-2); font-size: 14.5px; line-height: 1.5; }
.a-cd-reason { margin-top: 12px; }
.a-cd-btns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding: 18px 22px 20px; }
.a-unsaved { margin-inline-start: auto; }
.a-drawer header .a-unsaved + .a-x { margin-inline-start: 0; }
tr.a-pending > td { background: #fff8e1; }
td.a-pending { background: #fff8e1; box-shadow: inset 3px 0 0 #e3b44f; }
.a-pending-btns { display: inline-flex; gap: 6px; }
/* Settings: sections, full-width values, visibility badges, the lead-sheet check */
.a-settings { table-layout: fixed; }
.a-settings col.a-set-key { width: 32%; }
.a-settings col.a-set-pub { width: 120px; }
.a-settings col.a-set-act { width: 150px; }
.a-set-val > input[type="text"], .a-set-val > textarea, .a-set-val .a-ps { width: 100%; box-sizing: border-box; }
.a-set-val > small { display: block; margin-top: 4px; }
.a-fixedval { display: flex; flex-direction: column; gap: 2px; }
.a-sheetcheck { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.a-sheetcheck small { overflow-wrap: anywhere; }
@media (max-width: 900px) { .a-settings { table-layout: auto; } .a-settings col.a-set-key { width: auto; } }
/* Settings: "To be provided" marker in a hint, the collapsed how-to under mail_logo_url */
.a-tbp { margin-inline-end: 6px; height: 18px; font-size: 11px; }
.a-howto-toggle { margin-top: 6px; font-size: 12.5px; color: var(--text-2); }
.a-howto-toggle summary { cursor: pointer; width: max-content; color: var(--text-2); text-decoration: underline; text-underline-offset: 2px; }
.a-howto-toggle summary:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-howto-toggle ol { margin: 6px 0 4px; padding-inline-start: 20px; line-height: 1.5; }
.a-howto-toggle p { margin: 0; }
/* Settings: focus point on the About photo preview (dot + the part the site shows) */
.a-focusbox { display: flex; flex-direction: column; gap: 6px; max-width: 420px; }
.a-focus { position: relative; display: block; width: 100%; aspect-ratio: 1920 / 800; overflow: hidden; border-radius: 8px; border: 1px solid var(--line); cursor: crosshair; }
.a-focus:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-focus img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.a-focus-win { position: absolute; border: 2px solid #fff; box-shadow: 0 0 0 9999px rgba(18, 18, 20, .45); border-radius: 4px; pointer-events: none; }
.a-focus-dot { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: var(--accent, #E5BF24); border: 2px solid #121214; box-shadow: 0 0 0 2px #fff; pointer-events: none; }
/* Settings: two-step sign-in switch (gold fill = on; the label next to it says On / Off) and its code step */
.a-twostep { display: flex; flex-direction: column; gap: 8px; }
.a-switch-row { display: inline-flex; align-items: center; gap: 10px; }
.a-switch { position: relative; width: 42px; height: 24px; flex: none; padding: 0; border-radius: 12px; border: 0; background: #d1d5db; cursor: pointer; transition: background .15s; }
.a-switch[aria-checked="true"] { background: var(--brand); }
.a-switch-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .25); transition: transform .15s; }
.a-switch[aria-checked="true"] .a-switch-knob { transform: translateX(18px); }
.a-switch:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-switch:disabled { opacity: .55; cursor: default; }
.a-twostep-code { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.a-twostep-code input { width: 9ch; letter-spacing: .2em; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .a-switch, .a-switch-knob { transition: none; } }
/* Uploads: the clicked button shows a spinner, "Uploading... 45%" / "Processing..." and the file name */
.a-upload { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; min-width: 0; }
.a-upload-name { font-weight: 400; color: var(--text-2); max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a-spin { width: 14px; height: 14px; flex: none; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: a-spin .8s linear infinite; }
@keyframes a-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .a-spin { animation: none; border-right-color: currentColor; opacity: .6; } }
.a-file.a-uploading { cursor: progress; }
.a-file.a-file-off { opacity: .5; cursor: not-allowed; }
.a-btn .a-upload-name { color: inherit; opacity: .8; }
/* Commerce demo: SKUs and labels */
.a-scanbox input[type="search"] { min-width: min(360px, 100%); font-family: monospace; font-size: 15px; }
.a-skucard { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 12px; }
.a-skucard .a-barcode { background: #fff; border: 1px solid var(--line); border-radius: 8px; max-width: 100%; height: auto; }
.a-skus .a-barcode { display: block; max-width: 220px; height: auto; }
/* Commerce demo: inventory */
.a-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--gap); margin: 0 0 var(--gap); }
.a-stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); padding: 18px 20px; min-width: 0; display: flex; flex-direction: column; }
.a-stat b { font: 700 26px/1.2 var(--font-head); margin-top: 4px; overflow-wrap: anywhere; }
.a-stat span { order: -1; font-size: 13px; color: var(--muted); font-weight: 600; }
.a-stat small { font-size: 13px; color: var(--muted); margin-top: 2px; }
.a-stat-bad { border-color: var(--bad-line); background: var(--bad-bg); }
/* phase 18: v23 stat(): figure on the left, a round icon on the right; and v23 .h3s (a drawer section heading) */
.a-stat.a-stat-ic { flex-direction: row; gap: 14px; align-items: flex-start; }
.a-stat-tx { display: flex; flex-direction: column; min-width: 0; }
.a-stat .a-stat-i { order: 2; margin-left: auto; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.a-stat .a-stat-i.a-tone-good { background: var(--good-bg); color: var(--good); } .a-stat .a-stat-i.a-tone-bad { background: var(--bad-bg); color: var(--bad); }
.a-stat .a-stat-i.a-tone-warn { background: var(--warn-bg); color: var(--warn); } .a-stat .a-stat-i.a-tone-info { background: var(--info-bg); color: var(--info); }
.a-stat .a-stat-i.a-tone-gold { background: var(--accent-soft); color: #8a6d00; } .a-stat .a-stat-i.a-tone-gray { background: var(--surface-2); color: var(--muted); }
.adm h3.a-h3s { font: 700 15px/1.4 var(--font); margin: 18px 0 8px; text-transform: none; letter-spacing: 0; color: var(--text); }
.a-stat-bad b { color: var(--bad); }
.a-moveform .a-toolbar { align-items: flex-end; }
.a-moveform .a-grow { flex: 1 1 220px; }
.a-moveform .a-grow input { width: 100%; }
.a-qty { width: 7ch; }
.a-stock .a-num, .a-moves .a-num { white-space: nowrap; }
.a-lowrow td { background: #fdf1f1; }
.a-rrow td { background: #f7f5ee; font-size: 13px; }
/* Commerce demo: orders */
.a-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.adm .a-tabs { display: flex; flex-wrap: nowrap; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 18px; overflow-x: auto; scrollbar-width: thin; }
.adm .a-tabs > button { display: inline-flex; align-items: center; gap: 6px; flex: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; margin-bottom: -1px; background: none; min-height: 0; padding: 10px 14px; font: 600 14.5px/1.5 var(--font); color: var(--muted); white-space: nowrap; cursor: pointer; }
.adm .a-tabs > button:hover { color: var(--text-2); }
.adm .a-tabs > button[aria-selected="true"], .adm .a-tabs > button.on { color: var(--text); border-bottom-color: var(--accent); background: none; }
.adm .a-tabs > button.haserr { color: var(--bad); }
.a-tabs .a-ncount { margin-left: 2px; height: 18px; min-width: 18px; font-size: 11px; }
/* tabs inside a drawer (v23 .dtabs): tighter */
.adm .a-drawer .a-tabs { gap: 2px; margin: 0 -2px 16px; }
.adm .a-drawer .a-tabs > button { padding: 9px 11px; font-size: 14px; }
.a-rowlink { cursor: pointer; }
.a-steps { display: flex; gap: 6px; list-style: none; padding: 0; margin: 0 0 14px; flex-wrap: wrap; }
.a-steps li { flex: 1 1 100px; border-top: 4px solid var(--line); padding-top: 6px; font-weight: 600; font-size: 13px; display: flex; flex-direction: column; }
.a-steps li.done { border-color: #E5BF24; }
.a-steps small { font-weight: 400; color: var(--text-2); }
.a-totals { max-width: 360px; margin-left: auto; }
.a-grand dt, .a-grand dd { font-weight: 700; font-size: 16px; }
.a-orderlines input[list] { width: 100%; min-width: 150px; }
.a-orderlines small { display: block; }
.a-price { width: 10ch; }
.a-ok { color: #1e5e2c; }
/* Packing and delivery */
.a-packscan input { font: 600 18px/1.2 ui-monospace, Consolas, monospace; padding: 12px; }
.a-scanmsg { margin: 8px 0; padding: 12px 14px; border-radius: 10px; font-weight: 700; font-size: 15px; }
.a-scanmsg.ok { background: #e3f4e6; color: #1e5e2c; }
.a-scanmsg.bad { background: #b3261e; color: #fff; }
.a-packprogress { font-size: 15px; }
.a-donerow td { background: #f0f8f1; }
.a-bin { width: 70px; }
.a-deliv { margin: 8px 0 12px; padding: 10px 12px; }
.a-deliv h4 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-2); }
.a-trip-head { display: grid; gap: 4px; margin-bottom: 10px; }
.a-trip-cash { font-size: 14px; }
.a-stops { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.a-stop { background: var(--surface); border: 1px solid var(--line); border-inline-start: 5px solid var(--accent); border-radius: 12px; padding: 12px; display: grid; gap: 6px; }
.a-stop-delivered { border-inline-start-color: var(--good); }
.a-stop-failed { border-inline-start-color: var(--bad); }
.a-stop-pickup { border-inline-start-color: #0b4f8a; }
.a-stop-picked_up { border-inline-start-color: var(--good); }
.a-pickup-what { background: #e6f2ff; color: #0b4f8a; border-radius: 8px; padding: 6px 8px; font-size: 14px; }
/* Commerce: returns */
.a-insp input { width: 6ch; }
.a-insp td { vertical-align: middle; }
.a-freeline td { background: #f0f8f1; }
.a-cashback { background: #fff8dc; border-radius: 8px; padding: 8px 10px; }
.a-offrow td { color: var(--text-2); background: #faf9f5; }
.a-tag { margin: 0 4px 2px 0; }
.a-custhead { margin: 0 0 8px; }
.a-timeline { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; }
.a-timeline li { border-inline-start: 3px solid var(--line); padding: 4px 10px; font-size: 14px; overflow-wrap: anywhere; }
.a-timeline .a-tl-activity { border-color: var(--accent); background: #fffbea; }
.a-timeline .a-tl-order, .a-timeline .a-tl-payment { border-color: #0b4f8a; }
.a-timeline .a-tl-return, .a-timeline .a-tl-wallet { border-color: #6b675e; }
.a-tl-when { color: var(--muted); font-size: 12px; }
.a-chart { position: relative; margin: 12px 0; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; max-width: 900px; }
.a-chart figcaption { font-size: 13px; color: var(--text-2); margin-bottom: 4px; }
.a-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.a-chart svg text { font-family: inherit; }
.a-chart svg g:focus { outline: none; }
.a-chart svg g:hover path, .a-chart svg g:focus path { opacity: .82; }
.a-chart-tip { position: absolute; z-index: 5; pointer-events: none; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; font-size: 12px; color: var(--text-2); box-shadow: 0 4px 14px rgba(18, 18, 20, .12); min-width: 160px; }
.a-chart-tip b { color: var(--text); font-size: 13px; }
.a-chart-tip-t { color: var(--text); font-weight: 600; margin-bottom: 2px; }
.a-totalrow td { font-weight: 700; border-top: 2px solid var(--text); }
.a-report-table h2 { font-size: 15px; margin: 18px 0 6px; }
.a-business { margin-bottom: 16px; }
.a-wallet h3 { margin: 0; }
.a-stop-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.a-stop-meta { font-size: 13px; }
.a-collect { color: var(--bad); }
.a-stop-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.a-stop-actions .a-btn { min-height: 44px; flex: 1 1 120px; }
.a-stop-form { display: grid; gap: 8px; background: #faf8f1; border-radius: 10px; padding: 10px; }
.a-stop-form .a-btn { min-height: 44px; }
.a-btn-block { width: 100%; min-height: 48px; margin: 8px 0; }
.a-endtrip { margin-top: 14px; }
.a-tripcard { display: grid; gap: 4px; width: 100%; text-align: start; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 10px; font: inherit; color: var(--text); cursor: pointer; min-height: 64px; }
.a-mytrips { max-width: 640px; }
/* Inventory: tabs, scan box, stock-in lines */
.a-scanbox { max-width: 420px; margin: 10px 0 4px; }
.a-scanbox input { font-family: ui-monospace, Consolas, monospace; }
.a-batchfields { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12.5px; }
.a-batchfields input:not([type="date"]) { width: 110px; }
.a-batchfields label { display: inline-flex; gap: 4px; align-items: center; }
.a-silines div { font-size: 12.5px; }
/* Orders: overdue badge, addresses, payments, history */
.a-overdue { margin-inline-start: 6px; }
.a-addr { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 10px 0; }
.a-addr .a-card { margin: 0; padding: 12px; }
.a-addr h4 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-2); }
.a-gst { margin: 6px 0 12px; font-weight: 600; }
.a-filters { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 12px; }
.a-filters label { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; max-width: 100%; min-width: 0; }
.a-filters select { max-width: 100%; min-width: 0; text-overflow: ellipsis; }
.a-hist { list-style: none; padding: 0; margin: 0; }
.a-hist li { padding: 4px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.a-avail { display: block; font-size: 12px; }
.a-avail.a-bad { font-weight: 700; }
/* Products and prices: grid, missing badge, save bar */
.a-pricegrid td, .a-pricegrid th { vertical-align: top; }
.a-pricegrid .a-pricecell { min-width: 96px; }
.a-pricegrid .a-pricecell input { width: 84px; text-align: right; }
.a-pricegrid .a-pricecell input::placeholder { color: #8f8a7e; }
.a-pricegrid .a-pricecell small { display: block; text-align: right; font-size: 11.5px; }
.a-pricegrid td.a-pending input { background: #fff3cd; border-color: #c79714; }
.a-pricegrid td.a-cell-bad input { border-color: var(--bad); background: #fbeceb; }
.a-miss { margin-inline-start: 4px; }
.a-pricecell .a-miss { display: block; width: max-content; margin: 4px 0 0 auto; }
.a-savebar { position: sticky; bottom: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 12px; padding: 12px 16px;
  background: var(--text); color: #fff; border-radius: 12px; box-shadow: 0 -4px 16px rgba(18, 18, 20, .18); }
.a-savebar .a-btn-ghost { color: #fff; border-color: rgba(255, 255, 255, .45); }
.a-savebar .a-btn:not(.a-btn-ghost) { background: var(--accent); border-color: var(--accent); color: var(--text); }
.a-savebar .a-muted { color: #d9d4c4; }
.a-savebar input[type="date"] { margin-inline-start: 6px; }
.a-ordernote { display: block; font-size: 12px; }
/* Roles, approvals, commerce settings, No access */
.a-plainset { border: 0; margin: 0; padding: 0; min-width: 0; }
.a-plainset:disabled .a-switch, .a-plainset:disabled input, .a-plainset:disabled select { cursor: not-allowed; }
.a-builtin { margin-inline-start: 8px; }
.a-center { text-align: center; }
.a-permgrid th[scope="row"] { font-weight: 600; min-width: 220px; }
.a-permgrid td input[type="checkbox"] { width: 18px; height: 18px; }
.a-approvals { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
.a-approval { margin: 0; }
.a-approval-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.a-approval-amt { font-weight: 700; }
.a-approval p { margin: 6px 0; }
.a-approval-decide { max-width: 520px; }
.a-rolepick { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.a-csettings .a-cs-label { width: 42%; }
.a-csettings input.a-wide { width: 100%; max-width: 460px; }
.a-listed { margin: 10px 0 18px; }
.a-listed-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.a-listed-head h3 { margin: 0; }
.a-noaccess { max-width: 640px; }
/* Commerce demo: operations cards are links */
.a-statlink { text-decoration: none; color: var(--text); }
.a-statlink:hover, .a-statlink:focus-visible { border-color: var(--line-2); box-shadow: var(--shadow-lg); }
.a-statlink small { font-size: 12px; color: var(--text-2); margin-top: 2px; }
/* Commerce demo: + New customer in the order form */
.a-newcust { margin-inline-start: 10px; font-weight: 600; text-transform: none; letter-spacing: 0; }
/* Commerce demo: returns */
.a-returnform { margin-top: 14px; }
/* Excel import: before / after values wrap (long text, Tamil / Hindi keep their shaping via the cell's lang) */
.a-difftable td { vertical-align: top; }
.a-difftable td:nth-child(3), .a-difftable td:nth-child(4) { min-width: 160px; max-width: 440px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
/* Size picker: page hint, product cell, "Selected first" badge, scale field with its live napkin preview */
.a-pagehint { margin: -6px 0 12px; max-width: 80ch; }
.a-prodcell { display: inline-flex; align-items: center; gap: 8px; }
.a-prodcell code { font-size: 11.5px; white-space: nowrap; }
.a-firstbadge { display: inline-flex; align-items: center; justify-content: center; height: 22px; padding: 0 10px; border-radius: 999px; background: var(--text); color: #fff; font-size: 11.5px; font-weight: 700; line-height: 1; white-space: nowrap; box-sizing: border-box; }
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
.a-ps-btn { width: 100%; min-height: 36px; box-sizing: border-box; display: grid; grid-template-columns: 32px auto minmax(0, 1fr) 14px; align-items: center; gap: 8px; padding: 2px 8px 2px 4px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.a-ps-btn > .a-ps-name:first-child { grid-column: 1 / 4; padding-left: 6px; }
.a-ps-btn:disabled { background: #f6f3ea; cursor: default; }
.a-ps-btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-ps-caret { color: var(--muted); font-size: 11px; text-align: right; }
.a-ps-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.a-ps code, .a-pick code, .a-chosen code { flex: none; font-size: 11.5px; white-space: nowrap; }
.a-ps-pop { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: max(100%, 340px); max-width: min(480px, calc(100vw - 32px)); box-sizing: border-box; padding: 6px; background: #fff; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(18, 18, 20, .18); }
.a-ps-pop input[type="search"] { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.a-ps-pop ul { list-style: none; margin: 0; padding: 0; max-height: min(320px, 50vh); overflow-y: auto; overscroll-behavior: contain; }
.a-ps-opt { display: grid; grid-template-columns: 32px auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: 44px; box-sizing: border-box; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.a-ps-opt > .a-ps-name:first-child { grid-column: 1 / -1; }
.a-ps-opt .a-ps-name { white-space: normal; }
.a-ps-var { padding-left: 26px; }
.a-ps-active { background: #fbf3d5; }
.a-ps-opt[aria-selected="true"] { font-weight: 700; }
.a-ps-opt.a-off { color: var(--muted); }
.a-ps-group { padding: 8px 6px 4px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.a-ps-none { padding: 10px 6px; color: var(--muted); font-size: 13px; }
@media (max-width: 560px) { .a-ps-pop { width: 100%; max-width: none; } }
/* drawer sections (kits: text per language, Selected, Products) with clear space between them */
.a-dsec { margin-top: 30px; }
.adm .a-dsec h3 { margin: 0 0 6px; }
.a-kitpick-hint { margin: 0 0 10px; font-size: 12.5px; line-height: 1.45; max-width: 70ch; }
.a-kitpick input[type="search"] { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.a-pick-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 4px; }
/* one row per product: [checkbox] [photo 40] [ID] [name], vertically centred; the whole row toggles */
.a-pick { display: grid; grid-template-columns: 18px 40px auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1.3; }
.a-pick:hover { background: #fbf8ef; }
.a-pick input[type="checkbox"] { width: 16px; height: 16px; margin: 0; }
.a-pick-name { min-width: 0; overflow-wrap: anywhere; }
.a-pick-var { padding-left: 34px; }
.a-pick.a-off { color: var(--muted); }
.a-pick-none { margin: 8px; }
.a-pick-note { margin: 0 0 6px; font-size: 12.5px; }
.a-chosen { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.a-chosen li { display: grid; grid-template-columns: 14px 18px 40px auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; background: #fffdf6; font-size: 13px; line-height: 1.3; }
.a-chosen li[draggable="true"] { cursor: grab; }
.a-chosen li:not([draggable="true"]) { grid-template-columns: 18px 40px auto minmax(0, 1fr); }
.a-chosen .a-num { font-weight: 700; }
.a-chosen-name { min-width: 0; overflow-wrap: anywhere; }
.a-chosen-btns { display: flex; gap: 2px; }
.a-chosen-btns .a-btn { min-width: 28px; padding: 2px 6px; }
.a-handle { cursor: grab; color: var(--muted); }
.a-dragging, .a-dragging td { opacity: .45; }
/* Products: a small version of the home page's featured ("Most loved") rail */
.a-kicker { margin: 0 0 2px; font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.a-featured h2 { margin: 0 0 2px; }
.a-featured > .a-muted { margin: 0 0 10px; }
.a-featured-list { list-style: none; margin: 0; padding: 2px 2px 8px; display: flex; gap: 10px; overflow-x: auto; }
.a-featured-list li { flex: none; width: 128px; display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: #fffdf6; cursor: pointer; font-size: 12.5px; line-height: 1.3; }
.a-featured-list li[draggable="true"] { cursor: grab; }
.a-featured-list li:hover { border-color: var(--text); }
.a-featured-list li:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.a-featured-list li.a-off { color: var(--muted); }
.a-featured-list li.a-off img { opacity: .5; }
.a-featured-list code { font-size: 11px; }
.a-feat-photo { position: relative; display: grid; place-items: center; height: 96px; border-radius: 8px; background: #fff; font-size: 11px; }
.a-feat-photo img { width: 96px; height: 96px; object-fit: contain; }
.a-feat-photo .a-num { position: absolute; top: 4px; left: 4px; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 11px; background: var(--text); color: #fff; font-weight: 700; font-size: 12px; line-height: 22px; text-align: center; box-sizing: border-box; }
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
.a-dot:focus-within { outline: 2px solid var(--text); outline-offset: 3px; }
.a-swatch-row input { flex: 1; min-width: 0; }

.a-pager { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.a-grid td { min-width: 200px; }
.a-grid td:first-child { min-width: 180px; max-width: 260px; }
.a-grid .a-group th { background: #efeadb; text-transform: uppercase; letter-spacing: .06em; }
.a-missing, .adm .a-missing textarea, .adm input.a-missing, .adm textarea.a-missing { background: #fdecea; }
.a-diff { max-width: 520px; overflow-wrap: anywhere; font-size: 12.5px; }
.a-diff del { color: var(--bad); }
.a-diff ins { color: var(--good); text-decoration: none; }
.a-dl { display: grid; gap: 4px; margin: 0; }
.a-dl div { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 8px; }
.a-dl dt { color: var(--muted); }
.a-dl dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.a-report h3 { margin-top: 16px; }

.a-tr { display: grid; grid-template-columns: 150px repeat(var(--cols), minmax(180px, 1fr)); gap: 6px; overflow-x: auto; }
.a-tr-head { font-weight: 600; font-size: 12.5px; padding: 4px 0; }
.a-tr-label { font-size: 13px; padding-top: 7px; }
.a-tr-help { display: block; font-size: 11.5px; line-height: 1.35; margin-top: 2px; }
.a-tr input, .a-tr textarea { width: 100%; }
.a-tr-over { display: flex; align-items: center; gap: 8px; min-width: 0; } .a-tr-over input { flex: 1; min-width: 0; } .a-tr-over .a-link { flex: none; padding: 4px 0; font-size: 12.5px; white-space: nowrap; }
.a-tr-over input::placeholder { color: #8a8577; opacity: 1; } .a-tr-main { font-size: 12.5px; padding-top: 7px; }

.a-townmap { margin: 12px 0; max-width: 100%; min-width: 0; }
.a-townmap svg { display: block; width: 100%; max-width: 100%; height: auto; overflow: visible; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
.a-townmap figcaption { font-size: 12px; margin-top: 4px; }
.a-count { display: block; text-align: end; font-size: 11px; color: var(--muted); }
.a-count.a-bad { color: #b42318; }
.a-picture { display: grid; gap: 6px; justify-items: start; }
.a-picture img { display: block; max-width: 100%; height: auto; object-fit: cover; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
.a-picture-none { display: grid; place-items: center; width: 240px; max-width: 100%; height: 100px; border: 1px dashed var(--line); border-radius: 8px; font-size: 12px; color: var(--muted, #666); }
.a-photos { display: flex; flex-wrap: wrap; gap: 12px; }
.a-photos figure { margin: 0; width: 180px; }
.a-photos img { width: 140px; height: 140px; object-fit: contain; background: #fff; border: 1px solid var(--line); border-radius: 8px; display: block; }
.a-photos img.a-banner-desktop { width: 180px; height: 75px; object-fit: cover; }
.a-photos img.a-banner-mobile { width: 108px; height: 135px; object-fit: cover; }
.a-photos figcaption { font-size: 12px; display: grid; gap: 4px; margin-top: 4px; }

.a-drawer-wrap { position: fixed; inset: 0; background: rgba(16, 18, 22, .45); display: flex; justify-content: flex-end; z-index: 60; }
.a-drawer { width: min(620px, 100vw); height: 100%; background: var(--surface); display: flex; flex-direction: column; box-shadow: var(--shadow-lg); animation: a-din .2s ease-out; }
.a-drawer.a-drawer-wide { width: min(1100px, 100vw); }
@keyframes a-din { from { transform: translateX(30px); opacity: .6; } to { transform: none; opacity: 1; } }
.a-drawer header { display: flex; gap: 12px; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); flex: none; }
.adm .a-drawer header h2 { margin: 0; flex: 1; font: 700 19px var(--font-head); overflow-wrap: anywhere; min-width: 0; }
.a-dsub { display: block; font: 400 13px var(--font); color: var(--muted); margin-top: 2px; }
.a-thumb2 { width: 44px; height: 44px; border-radius: 8px; background: #faf8f1; border: 1px solid var(--line); display: grid; place-items: center; flex: none; overflow: hidden; }
.a-thumb2 img { width: 100%; height: 100%; object-fit: cover; display: block; }
.a-drawer footer { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 14px 20px; border-top: 1px solid var(--line); background: var(--surface-2); flex: none; }
.a-drawer-body { padding: 20px; overflow-y: auto; overflow-x: hidden; flex: 1; min-width: 0; } /* x: safety net only, nothing should be wider */
.a-statusbar .a-custhead { margin: 4px 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2); }
.a-statusbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm); margin-bottom: 14px; }

@media (max-width: 900px) {
  .a-shell, .a-shell.collapsed { grid-template-columns: minmax(0, 1fr); }
  .a-side { position: fixed; z-index: 60; left: 0; top: 0; bottom: 0; width: min(300px, 86vw); transform: translateX(-102%); transition: transform .2s; box-shadow: var(--shadow-lg); visibility: hidden; }
  .a-side.open { transform: none; visibility: visible; }
  .a-nav-backdrop { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(16, 18, 22, .45); }
  .a-head { padding: 0 10px; gap: 6px; }
  .a-no-phone { display: none !important; }
  .a-me-t { display: none; }
  .a-main { padding: 20px 16px 40px; }
  .adm .a-ph h1 { font-size: 22px; }
  .a-kv { grid-template-columns: minmax(0, 1fr); gap: 2px 0; } .a-kv dd { margin-bottom: 8px; }
  .a-hide-sm { display: none; }
  .a-tw .a-table td:not(.a-num) { min-width: 9.5em; } /* text columns keep a readable width; the table box scrolls sideways */
  .a-tw .a-table td:first-child { min-width: 8em; }
  .a-drawer header .a-pill { display: none; }
  .a-dl div { grid-template-columns: 1fr; gap: 0; }
  .a-rules td.a-num { white-space: normal; } .a-rules .a-above { white-space: normal; flex-wrap: wrap; } .a-rules .a-numin { width: 60px; } .a-rules tr:not(.a-grp-row) td { padding-left: 10px; padding-right: 10px; }
}
@media (prefers-reduced-motion: reduce) { .adm * { transition: none !important; animation: none !important; } }
/* Setup > Notifications: channels, the template editor with its live preview, the log; the order / customer messages */
.a-channels .a-tile { gap: 8px; }
.a-events td:last-child { white-space: nowrap; }
.a-tpl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.a-tpl textarea { width: 100%; font: 14px/1.5 inherit; }
.a-tpl-prev { position: sticky; top: 12px; min-width: 0; }
.a-mailprev { width: 100%; height: 640px; border: 1px solid var(--line); border-radius: 12px; background: #F6F1E4; }
.a-mailsubj { margin: 0 0 8px; overflow-wrap: anywhere; }
.a-nlog td { overflow-wrap: anywhere; }
.a-timeline .a-tl-notification { border-color: #2a78d6; }
@media (max-width: 1100px) { .a-tpl { grid-template-columns: minmax(0, 1fr); } .a-tpl-prev { position: static; } .a-mailprev { height: 520px; } }
/* Foundation screens (phase 12a, v23 Godowns / Staff / Roles / Approval rules / Stand-ins): the lead line, godown cards,
   the count line above a list, role cards, the roles grid */
.a-lead { color: var(--text-2); margin: -4px 0 16px; max-width: 900px; }
.a-kitgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); }
.a-kitcard { padding: 16px; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.a-kitcard.dim { opacity: .7; }
.a-kh { display: flex; gap: 12px; align-items: center; }
.a-kh .a-sp { flex: 1; }
.a-kh b { display: block; font: 700 16px var(--font-head); }
.a-kh span.a-kh-sub { display: block; font-size: 13px; color: var(--muted); }
.a-kh .a-thumb2 { width: 52px; height: 52px; color: var(--text-2); }
.adm .a-kvs { grid-template-columns: 96px 1fr; font-size: 13.5px; gap: 6px 12px; }
.adm .a-kvs dd { font-weight: 500; }
.a-kfoot { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.a-hint-s { font-size: 12.5px; color: var(--muted); margin: 10px 0 0; }
.a-countline { padding: 10px 16px; font-size: 13.5px; color: var(--muted); border-bottom: 1px solid var(--line); background: var(--surface); }
.a-countline b { color: var(--text); }
.a-listcard { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); margin-bottom: var(--gap); overflow: hidden; }
.a-listcard .a-tw { border: 0; border-radius: 0; box-shadow: none; margin: 0; }
.a-person2 { display: flex; align-items: center; gap: 10px; }
.a-person2 b { display: block; font-weight: 600; line-height: 1.3; }
.a-person2 small { color: var(--muted); font-size: 12.5px; }
.a-sub-l { display: block; font-size: 12.5px; color: var(--muted); }
.a-rolecards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.adm .a-rolecards button { box-sizing: border-box; cursor: pointer; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 9px 14px; background: var(--surface); min-width: 130px; text-align: left; font: inherit; color: var(--text); }
.adm .a-rolecards button:hover { border-color: var(--line-2); }
.adm .a-rolecards button[aria-pressed="true"] { border-color: var(--brand); box-shadow: inset 0 0 0 1px var(--brand); background: var(--accent-soft); }
.a-rolecards b { display: block; font-size: 14.5px; }
.a-rolecards small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.a-cardh { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.adm .a-cardh h2 { font: 700 var(--fs-h2) var(--font-head); margin: 0; flex: 1; }
.a-cardb { padding: 20px; }
/* Approvals (phase 12b): the pending queue as v23's three cards, the count right after the title */
.a-rqgroup { margin-bottom: var(--gap); }
.adm .a-rqgroup .a-cardh h2 { flex: none; }
.a-rqgroup .a-approvals { margin-top: 0; }
.a-rqgroup .a-cardb > p { margin: 0; }
.a-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 18px; }
.a-rolegrid td, .a-rolegrid th { text-align: center; }
.a-rolegrid td:first-child, .a-rolegrid th:first-child { text-align: left; }
.a-rolegrid td.chg { background: var(--warn-bg); }
.a-rolegrid tbody tr { cursor: default; }
.a-rolegrid td { height: auto; padding-top: 9px; padding-bottom: 9px; }
.a-signers { font-size: 13.5px; }
.a-signers small { color: var(--muted); font-size: 12px; }
.a-rules td { height: auto; padding-top: 10px; padding-bottom: 10px; }
.a-rules tr.a-grp-row td { background: var(--surface-2); font-weight: 700; font-size: 12.5px; height: 34px; padding-top: 0; padding-bottom: 0; letter-spacing: .3px; text-transform: uppercase; color: var(--text-2); }
.a-rules .a-note-l { display: block; font-size: 12.5px; color: var(--muted); font-weight: 400; }
.a-rules .a-rule-wait { color: var(--warn); font-weight: 600; }
.a-numin { width: 92px; height: 34px; min-height: 34px; text-align: right; }
.a-above { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.adm .a-roleedit { padding: 0; overflow: hidden; }
.a-roleedit .a-field input + input, .a-roleedit .a-field select + input { margin-top: 6px; }
.a-roleedit .a-tw, .a-roleedit .a-scroll { border-top: 1px solid var(--line); }
/* phase 12b: Send a month to the CA (Reports > Accounting) */
.adm .a-books { padding: 0; overflow: hidden; }
.a-books .a-cardb > * + * { margin-top: 10px; }
.a-books .a-cardb > p, .a-books .a-cardb > .a-filters { margin-bottom: 0; }
.adm .a-books h3 { margin: 8px 0 0; }
.adm .a-rolepeople { padding: 6px 12px; display: inline-block; margin-bottom: var(--gap); }
.a-rolepeople summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.a-rolepeople p { margin: 8px 0 0; font-size: 13.5px; }
.a-cardh .a-btn { flex: none; }
.adm .a-listcard .a-card-flush { border: 0; border-radius: 0; box-shadow: none; margin: 0; }
.a-addstaff { display: grid; gap: 16px; }
@media (max-width: 900px) {
  .a-kitgrid { grid-template-columns: minmax(0, 1fr); }
  .a-grid3 { grid-template-columns: minmax(0, 1fr); }
  .adm .a-kvs { grid-template-columns: 1fr; gap: 0; } .adm .a-kvs dd { margin-bottom: 6px; }
}
/* phase 13 Numbering and Switches */
.a-numtab td { height: 52px; padding-top: 0; padding-bottom: 0; vertical-align: middle; } /* v23: 52px rows, a per-godown row grows */
.a-numtab th.a-nsw-c, .a-numtab td.a-nsw-c { text-align: center; }
.a-nsw-sub { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }
.adm .a-nsw-prefix { width: 84px; text-align: left; text-transform: uppercase; }
.a-nsw-runs { white-space: nowrap; }
.a-nsw-runs > span { display: block; line-height: 1.5; }
.a-nsw-acts { white-space: nowrap; text-align: end; }
.a-nsw-acts .a-btn + .a-btn { margin-inline-start: 6px; }
.a-nsw-runs .a-link { padding: 2px 0; font-size: 12.5px; }
.a-nsw-how p { margin: 0 0 8px; color: var(--text-2); }
.a-nsw-how p:last-child { margin-bottom: 0; }
.a-nsw-lay { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: var(--gap); align-items: start; }
.a-nsw-nav { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 10px; position: sticky; top: 76px; }
.a-nsw-navh { font: 700 12px var(--font); letter-spacing: .6px; text-transform: uppercase; color: var(--muted); padding: 6px 10px 8px; }
.adm .a-nsw-nav button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border-radius: var(--r-sm); cursor: pointer; color: var(--text-2); font-size: 14.5px; font-weight: 500; }
.adm .a-nsw-nav button:hover { background: var(--surface-2); }
.adm .a-nsw-nav button:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.adm .a-nsw-nav button[aria-current="true"] { background: var(--accent-soft); color: var(--text); font-weight: 700; box-shadow: inset 3px 0 0 var(--accent); }
.a-nsw-nav .a-ncount { margin-inline-start: auto; }
.adm .a-nsw-card { margin-bottom: 0; }
.a-nsw-row { display: flex; gap: 16px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid var(--line); }
.a-nsw-row:last-child { border-bottom: 0; padding-bottom: 0; }
.a-nsw-txt { flex: 1; min-width: 0; }
.a-nsw-txt b { display: block; }
.a-nsw-txt span { display: block; color: var(--text-2); font-size: 14px; }
.a-nsw-txt em { display: block; font-style: normal; color: var(--muted); font-size: 13px; margin-top: 4px; }
.a-nsw-txt small { display: block; font-size: 12.5px; margin-top: 4px; }
.a-nsw-wait { color: var(--warn); font-weight: 600; }
.a-nsw-ctl { flex: none; padding-top: 2px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 100%; }
.a-nsw-ctl select { max-width: 100%; }
.a-nsw-range { font-size: 12px; }
@media (max-width: 900px) {
  .a-nsw-hide { display: none; }
  .a-nsw-lay { grid-template-columns: minmax(0, 1fr); }
  .a-nsw-nav { position: static; display: flex; overflow-x: auto; padding: 6px; gap: 4px; }
  .a-nsw-navh { display: none; }
  .adm .a-nsw-nav button { width: auto; white-space: nowrap; flex: none; }
  .a-nsw-row { flex-direction: column; gap: 8px; }
  .a-nsw-ctl { align-items: flex-start; }
}
/* phase 13 Audit and Communications */
.a-au-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.a-au-fi { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--surface); padding: 0 10px; min-height: 38px; color: var(--muted); font-size: 13.5px; }
.a-au-fi:focus-within { border-color: var(--text); }
.adm .a-au-fi input, .adm .a-au-fi select { border: 0; background: transparent; min-height: 36px; padding: 0; box-shadow: none; min-width: 0; max-width: 100%; color: var(--text); font-size: 14px; }
.adm .a-au-fi input:focus, .adm .a-au-fi select:focus { outline: none; }
.a-au-grow { flex: 1 1 220px; }
.a-au-grow input { flex: 1; width: 100%; }
.a-au-t td { vertical-align: middle; height: 52px; padding-top: 0; padding-bottom: 0; } /* v23: 52px rows */
.adm .a-au-fi select { max-width: 190px; }
.a-numtab td.a-nsw-runs, .a-au-t td.a-au-diff { padding-top: 6px; padding-bottom: 6px; } /* cells of several lines keep room */
.a-au-more { font-size: 12.5px; padding: 2px 0; }
.a-au-when { white-space: nowrap; }
.a-au-diff { max-width: 520px; overflow-wrap: anywhere; font-size: 13px; }
.a-au-ch + .a-au-ch { margin-top: 3px; }
.a-au-f { color: var(--muted); margin-inline-end: 6px; }
.a-au-f::after { content: ":"; }
.a-au-diff s { color: var(--bad); }
.a-au-diff ins { color: var(--good); text-decoration: none; font-weight: 600; }
.a-au-pager { padding: 0 16px 14px; }
.a-nt-c { text-align: center; width: 120px; }
.a-nt-ev td { height: auto; padding-top: 10px; padding-bottom: 10px; vertical-align: top; }
.a-nt-ev td.a-nt-c { vertical-align: middle; }
.a-nt-ev tr.a-nt-grp td { background: var(--surface-2); font-weight: 700; font-size: 12.5px; letter-spacing: .3px; text-transform: uppercase; color: var(--text-2); padding-top: 8px; padding-bottom: 8px; }
.a-nt-ev tbody tr { cursor: default; }
.a-nt-channels { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.a-nt-chan { display: grid; gap: 6px; justify-items: start; }
.a-nt-p { margin: 0; color: var(--text-2); }
.a-nt .a-listcard .a-cardh .a-btn { flex: none; }
.a-mt-snip small { color: var(--text-2); }
.a-mt-langs { margin-bottom: 14px; }
.adm .a-mt-h { margin: 0 0 6px; font: 700 15px var(--font-head); }
.a-ob-filters { padding: 12px 16px; margin: 0; border-bottom: 1px solid var(--line); }
.a-ob-q input { width: 220px; max-width: 100%; }
.a-ob-dl { margin-bottom: 14px; }
.a-ob-msg { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); padding: 12px 14px; }
.a-ob-msg p { margin: 0 0 8px; }
.a-ob-body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; }
@media (max-width: 900px) {
  .a-au-fi, .a-au-grow { flex: 1 1 100%; }
  .a-au-fi select { flex: 1; }
  .a-nt-c { width: auto; }
  .a-ob-q, .a-ob-q input { width: 100%; }
}
/* phase 13 Company */
.a-seclay { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: var(--gap); align-items: start; }
.a-secnav { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 10px; position: sticky; top: calc(var(--head) + 12px); }
.a-secnav .a-snh { font: 700 12px var(--font); letter-spacing: .6px; text-transform: uppercase; color: var(--muted); padding: 6px 10px 8px; }
.adm .a-secnav button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border-radius: var(--r-sm); cursor: pointer; color: var(--text-2); font-size: 14.5px; font-weight: 500; }
.adm .a-secnav button:hover { background: var(--surface-2); }
.adm .a-secnav button:focus-visible { outline: 2px solid var(--accent); }
.adm .a-secnav button[aria-current="true"] { background: var(--accent-soft); color: var(--text); font-weight: 700; box-shadow: inset 3px 0 0 var(--accent); }
.a-co-miss { margin-left: auto; background: var(--bad); color: #fff; border-radius: 999px; font-size: 11.5px; font-weight: 700; min-width: 20px; height: 20px; display: inline-grid; place-items: center; padding: 0 6px; }
.adm .a-co-card { padding: 0; overflow: hidden; }
.a-co-h { flex: 1; min-width: 0; }
.adm .a-co-h h2 { font: 700 var(--fs-h2) var(--font-head); margin: 0; }
.a-co-h .a-hint-s { margin: 2px 0 0; }
.a-co-p { margin: 0; }
.a-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.a-co-logos { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.a-co-logo { display: flex; gap: 14px; align-items: center; min-width: 0; }
.a-co-logo b { display: block; }
.a-co-logo small { display: block; color: var(--muted); font-size: 12.5px; margin-bottom: 8px; }
.a-co-lbox { width: 120px; height: 120px; flex: none; border: 1px dashed var(--line-2); border-radius: var(--r-sm); display: grid; place-items: center; text-align: center; font-size: 12.5px; background: var(--surface-2); overflow: hidden; padding: 8px; box-sizing: border-box; }
.a-co-lbox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.a-co-logo.sm .a-co-lbox { width: 160px; height: 64px; }
.a-co-lacts { display: flex; gap: 6px; flex-wrap: wrap; }
.a-co-banks { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--gap); }
.a-co-bank { border: 1px solid var(--line); border-radius: var(--r); padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.a-co-bank.def { border-color: var(--accent-line); box-shadow: inset 0 0 0 1px var(--accent-line); }
.a-co-bank.dim { opacity: .7; }
.a-co-bank .a-kh .a-thumb2 { width: 44px; height: 44px; }
.a-co-bank .a-kv dd { overflow-wrap: anywhere; }
.a-co-copies { margin-bottom: 8px; }
.a-co-inl { margin-left: 8px; font-weight: 600; }
@media (max-width: 900px) {
  .a-seclay { grid-template-columns: minmax(0, 1fr); }
  .a-secnav { position: static; display: flex; overflow-x: auto; padding: 6px; gap: 4px; }
  .a-secnav .a-snh { display: none; }
  .adm .a-secnav button { width: auto; white-space: nowrap; flex: none; }
  .a-co-banks { grid-template-columns: minmax(0, 1fr); }
  .a-co-logos { gap: 14px; }
  .a-co-card .a-kv { grid-template-columns: minmax(0, 1fr); gap: 2px 0; } .a-co-card .a-kv dd { margin-bottom: 8px; }
}
/* phase 14: categories, kits, units, barcodes */
.a-p14-w50 { width: 50px; }
.a-p14-act { width: 1%; white-space: nowrap; text-align: end; }
.a-p14-prow { display: flex; align-items: center; gap: 12px; min-width: 0; }
.a-p14-prow b { font-weight: 600; display: block; line-height: 1.3; }
.a-p14-prow small { display: block; color: var(--muted); font-size: 12.5px; }
.a-p14-mv { display: inline-flex; gap: 2px; }
.a-bulkbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 16px; margin-bottom: 12px; background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: var(--r); font-size: 14px; }
.a-bulkbar .a-sp { flex: 1; }
.a-p14-addrow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--line); }
.a-p14-in, .a-p14-scanin { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 200px; min-width: 0; height: var(--ctl); padding: 0 10px; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--surface); color: var(--muted); box-sizing: border-box; }
.a-p14-in input, .a-p14-scanin input { flex: 1; min-width: 0; width: 100%; border: 0; outline: 0; background: none; height: 100%; padding: 0; font: inherit; color: var(--text); }
.a-p14-in:focus-within, .a-p14-scanin:focus-within { border-color: var(--text); }
.adm .a-p14-in input, .adm .a-p14-scanin input { border: 0; box-shadow: none; border-radius: 0; height: 100%; padding: 0; min-height: 0; } /* one border: the wrapper's */
.a-p14-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
@media (max-width: 560px) { .a-p14-addrow { gap: 12px; } .a-p14-addrow > * { flex: 1 1 100%; } .a-p14-addrow > .a-btn { justify-content: center; } }
@media (max-width: 900px) { .a-tw.a-p14-units .a-table td:not(.a-num) { min-width: 0; } } /* four short columns fit a phone, as v23 */
@media (max-width: 900px) { .a-p23-fit .a-tw .a-table td:not(.a-num), .a-p23-fit .a-tw .a-table td:first-child { min-width: 0; } } /* phase 23 reports and vouchers: columns as wide as their content, as v23 */
.a-p14-kit { cursor: pointer; }
.a-p14-kit:hover { border-color: var(--line-2); box-shadow: var(--shadow-lg); }
.a-p14-kit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.a-p14-kt { margin: 0; color: var(--text-2); font-size: 14px; }
.a-p14-kparts { display: flex; gap: 8px; flex-wrap: wrap; }
.a-p14-kp { display: flex; align-items: center; gap: 4px; }
.a-p14-kp small { color: var(--muted); font-weight: 600; }
.a-p14-gh { margin: 0 0 8px; font-size: 14px; }
.a-p14-pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.a-p14-why { margin-top: 4px; }
.adm .a-p14-fsec { margin: 20px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 15px; }
.a-p14-kitrow { margin-bottom: 10px; }
.a-p14-kr { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: 8px; }
.a-p14-kr select, .a-p14-kr input { width: 100%; min-width: 0; }
.a-p14-kitrow.a-err select { border-color: var(--bad); }
.a-p14-sw { margin-bottom: 14px; align-items: flex-start; }
.a-p14-btabs > button:first-child .a-ncount { background: var(--bad); color: #fff; }
.a-p14-lead { margin: 0 0 10px; color: var(--text-2); }
.a-p14-scanbox { display: flex; gap: 10px; }
.a-p14-scanbox .a-p14-scanin { height: 52px; font-size: 17px; }
.a-p14-scanbox .a-p14-scanin input { font-family: ui-monospace, Consolas, monospace; font-size: 17px; }
.adm .a-p14-find { height: 52px; }
.a-p14-scanres { display: flex; gap: 14px; align-items: center; margin-top: 14px; padding: 14px; border: 1px solid var(--good-line); background: var(--good-bg); border-radius: var(--r); }
.a-p14-scanres > div { flex: 1; min-width: 0; }
.a-p14-scanres b { display: block; font-size: 15.5px; overflow-wrap: anywhere; }
.a-p14-scanres span { font-size: 13.5px; color: var(--text-2); }
.a-p14-mt6 { margin-top: 6px; } .a-p14-mt12 { margin-top: 12px; }
.a-p14-inline { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.a-p14-inline select { height: var(--ctl); max-width: 100%; min-width: 0; }
.a-p14-grow { flex: 1 1 220px; }
.a-p14-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap); align-items: start; }
.a-p14-two .a-card { margin-bottom: 0; }
.a-p14-pad { padding: 12px 16px 4px; }
.a-p14-search { width: 100%; flex: none; }
.a-p14-lablist { max-height: 420px; overflow-y: auto; padding: 6px; }
.a-p14-labrow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.a-p14-labrow:hover { background: var(--surface-2); }
.a-p14-labrow > span:last-child { min-width: 0; }
.a-p14-labrow b { display: block; font-size: 14px; }
.a-p14-labrow small { color: var(--muted); font-size: 12.5px; }
.a-p14-opts { display: grid; gap: 14px; }
.a-p14-btns { display: flex; gap: 10px; flex-wrap: wrap; }
.a-p14-labels { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.a-p14-label { border: 1px dashed var(--line-2); border-radius: 8px; padding: 12px; background: #fff; color: #111; font-size: 13px; line-height: 1.35; break-inside: avoid; min-width: 0; overflow: hidden; }
.a-p14-label > b { display: block; font-size: 14px; margin-bottom: 2px; }
.a-p14-line { display: block; }
.a-p14-decl { display: block; font-size: 11px; line-height: 1.35; margin-top: 6px; padding-top: 6px; border-top: 1px dotted #999; color: #111; }
.a-p14-label .a-barcode { display: block; max-width: 100%; height: auto; margin-top: 8px; }
@media (max-width: 900px) {
  .a-kitgrid, .a-p14-two { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .a-p14-scanbox { flex-wrap: wrap; } .a-p14-scanbox .a-p14-find { flex: 1 1 100%; }
  .a-p14-scanres { flex-wrap: wrap; }
  .a-p14-labels { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .a-p14-kit { transition: none; } }
/* phase 14: products and SKUs */
/* Products.js, SkuDrawer.js, RawMaterials.js (v23 .filters .field-i .count .bulk .prow .thumb .pager .form .fld .fsec .pics .skurow .inline-add .dtabs .ltabs) */
.p14-sp { flex: 1; }
.p14-filters { padding: 14px 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--line); }
.p14-fi { display: flex; align-items: center; gap: 8px; height: var(--ctl); border: 1px solid var(--line-2); border-radius: var(--r-sm); padding: 0 11px; background: var(--surface); color: var(--muted); min-width: 0; max-width: 100%; box-sizing: border-box; }
.adm .p14-fi input, .adm .p14-fi select { border: 0; outline: 0; box-shadow: none; background: none; color: var(--text); min-width: 0; flex: 1; min-height: 0; height: calc(var(--ctl) - 2px); padding: 0; }
.p14-fi:focus-within { border-color: var(--text-2); box-shadow: 0 0 0 3px rgba(229, 191, 36, .25); }
.p14-grow { flex: 1 1 260px; }
.p14-count { padding: 10px 16px; font-size: 13.5px; color: var(--muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.p14-count b { color: var(--text); }
.p14-bulk { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--accent-soft); border-bottom: 1px solid var(--accent-line); font-size: 14px; flex-wrap: wrap; }
.adm .a-listcard .p14-tw { border: 0; border-radius: 0; box-shadow: none; margin: 0; }
.p14-t th.p14-ck, .p14-t td.p14-ck { width: 44px; padding-right: 14px; }
.p14-t td.p14-act, .p14-t th.p14-act { width: 52px; text-align: end; }
.p14-t tr.p14-sel td { background: var(--accent-soft); }
.p14-prow { display: flex; align-items: center; gap: 12px; min-width: 0; }
.p14-pt { min-width: 0; }
.p14-pt b { font-weight: 600; display: block; line-height: 1.3; overflow-wrap: anywhere; }
.p14-pt small { color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
.p14-thumb { width: 44px; height: 44px; border-radius: 8px; background: #faf8f1; border: 1px solid var(--line); display: grid; place-items: center; flex: none; overflow: hidden; color: var(--muted); }
.p14-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.p14-nopic { width: 100%; height: 100%; display: grid; place-items: center; background: repeating-linear-gradient(45deg, #fff 0 4px, #f3efe3 4px 8px); }
.p14-rawpic { color: var(--text-2); }
.p14-sw { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .2); vertical-align: -1px; margin-right: 5px; }
.p14-minis { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.a-pill.p14-mini { height: 20px; font-size: 11.5px; padding: 0 8px; }
.p14-blk { display: block; }
.p14-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.p14-pager { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); font-size: 13.5px; color: var(--muted); flex-wrap: wrap; }
.p14-menu { position: fixed; z-index: 90; width: 240px; max-width: calc(100vw - 16px); }
.p14-five { margin-top: var(--gap); }
.adm .p14-five h2 { margin: 0 0 14px; font-size: 17px; }
.p14-five .a-kv dd { font-weight: 400; }
.p14-loved { display: flex; flex-wrap: wrap; gap: 12px; }
.p14-loved-it { display: grid; justify-items: center; gap: 4px; width: 112px; padding: 8px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); font: 13px/1.3 var(--font); color: var(--text); text-align: center; cursor: pointer; }
.p14-loved-it img, .p14-loved-none { width: 72px; height: 72px; border-radius: var(--r-sm); object-fit: cover; background: var(--bg); }
.p14-loved-it b { font-size: 12px; color: var(--text-2); }
.p14-dtabs > button > span:first-of-type { white-space: nowrap; }
.adm .p14-dtabs > button.haserr::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--bad); }
.p14-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 18px; }
.p14-form[hidden], .p14 [hidden] { display: none !important; }
.p14-full { grid-column: 1 / -1; }
.p14-fld { gap: 0; }
.p14-l { display: flex; align-items: center; gap: 4px; font-size: 13.5px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
.p14-fld > input, .p14-fld > select, .p14-fld > textarea { width: 100%; box-sizing: border-box; }
.adm .p14-fld > input:not([type=checkbox]):not([type=color]) { padding: 0 12px; } /* v23 .fld input: fixed height, side padding only */
.adm .a-drawer .p14-dtabs.p14-many > button { padding: 9px 9px; }
.p14-fld > .a-hint { margin-top: 5px; }
.p14-emsg { display: flex; gap: 5px; align-items: center; margin-top: 5px; }
.p14-fsec { grid-column: 1 / -1; font: 700 12.5px var(--font); letter-spacing: .6px; text-transform: uppercase; color: var(--muted); padding-top: 6px; border-top: 1px solid var(--line); margin-top: 4px; }
.p14-fsec:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.p14-small-h { font-size: 13px; }
.p14-hist { margin: 4px 0 0; font-size: 14px; color: var(--text-2); }
.p14-mt0 { margin-top: 0; } .p14-mb { margin-bottom: 12px; }
.p14-small { font-size: 12.5px; }
.p14-box { padding: 9px 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; overflow-wrap: anywhere; }
.p14-swrow { display: flex; gap: 8px; align-items: center; }
.adm .p14-swrow input[type="color"] { width: 44px; height: var(--ctl); padding: 2px; border: 1px solid var(--line-2); border-radius: var(--r-sm); background: var(--surface); flex: none; cursor: pointer; }
.p14-swrow input:not([type="color"]) { flex: 1; min-width: 0; }
.p14-ltabs { margin-bottom: 14px; max-width: 100%; overflow-x: auto; }
.p14-ltabs button.p14-lbad { color: var(--bad); }
.p14-dotw { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--bad); margin-left: 5px; vertical-align: 1px; }
.p14-pics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.p14-pic { position: relative; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #faf8f1; }
.p14-pic.p14-main { border: 2px solid var(--accent); }
.p14-pic img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.a-pill.p14-pm { position: absolute; top: 6px; left: 6px; margin: 0; }
.p14-pa { display: flex; gap: 6px; align-items: center; justify-content: space-between; padding: 6px; background: var(--surface); border-top: 1px solid var(--line); }
.adm .p14-del { width: 30px; height: 30px; color: var(--bad); }
.p14-upl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 10px 0 4px; }
.p14-upl .a-hint-s { margin: 0; }
.adm .p14-skurow { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-sm); margin-bottom: 8px; cursor: pointer; flex-wrap: wrap; background: var(--surface); font: inherit; color: var(--text); text-align: start; }
.adm .p14-skurow:hover { background: var(--surface-2); }
.p14-skurow:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.p14-skumeta { flex: 1; color: var(--muted); font-size: 13.5px; min-width: 160px; }
.p14-inline { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.p14-inline .p14-fi { flex: 1 1 220px; }
.adm .p14-sel { height: var(--ctl); min-height: var(--ctl); padding: 0 10px; }
.adm .p14-flat { box-shadow: none; margin-bottom: 8px; }
.p14-unitrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 14px; }
.adm .p14-unitrow select { flex: 1 1 140px; min-width: 0; }
.adm .p14-unitrow input { width: 96px; }
.p14-unitrow .p14-emsg { flex-basis: 100%; margin-top: 0; }
.p14-when { white-space: nowrap; font-size: 13px; }
.p14-diff { font-size: 13px; overflow-wrap: anywhere; }
.p14-diff s { color: var(--bad); } .p14-diff ins { color: var(--good); text-decoration: none; }
.p14-hist-t td { vertical-align: top; padding-top: 10px; padding-bottom: 10px; height: auto; }
.p14-show-sm { display: none; }
@media (max-width: 900px) {
  .p14-show-sm { display: block; }
  .a-tw .a-table.p14-t td.p14-ck, .a-tw .a-table.p14-t td.p14-act, .a-tw .a-table.p14-t td.p14-st { min-width: 0; }
  .a-tw .a-table.p14-t td.p14-pc { min-width: 9em; }
  .a-tw .a-table.p14-hist-t td { min-width: 0; }
  .p14-hist-t .p14-when { white-space: normal; }
}
@media (max-width: 640px) {
  .p14-form { grid-template-columns: minmax(0, 1fr); }
  .p14-pics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .p14-t th, .p14-t td { padding-left: 8px; padding-right: 8px; }
  .p14-t th.p14-ck, .p14-t td.p14-ck { padding-left: 14px; } /* v23 keeps the checkbox column padding on a phone */
  .p14-t .p14-thumb { width: 36px; height: 36px; }
  .p14-prow { gap: 8px; }
  .p14-hist-t tr { display: grid; grid-template-columns: minmax(0, 1fr); }
  .p14-hist-t td { border-bottom: 0; padding-top: 4px; padding-bottom: 4px; }
  .p14-hist-t tr { border-bottom: 1px solid var(--line); }
}
/* phase 15: prices and tax, logo and brand images */
.a-p15-basis { display: flex; align-items: center; gap: 6px; }
.a-p15-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 12px; }
.adm .a-p15-cards .a-card { padding: 16px; }
.a-p15-lhead { display: flex; gap: 12px; align-items: center; }
.a-p15-lhead small { display: block; font-size: 13px; }
.a-p15-thumb { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 10px; color: var(--text-2); }
.a-p15-lname { font-size: 16px; margin: 0 4px; }
.a-p15-sp { flex: 1; }
.adm .a-p15-bar.a-card { padding: 10px 12px; }
.a-p15-hsn td { font-size: 13.5px; }
.adm .a-p15-lcard { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; text-align: left; cursor: pointer; margin: 0; font: inherit; color: inherit; }
.adm .a-p15-lcard:hover { border-color: var(--accent); }
.a-p15-lcard b { font-size: 16px; }
.a-p15-pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.a-p15-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.a-p15-bar h2 { margin: 0 4px; font-size: 20px; }
.a-p15-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
.a-p15-filters select { max-width: 100%; }
.a-p15-sub { display: block; }
.a-p15-types { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.a-p15-hist { margin: 0 0 12px; padding-left: 18px; }
.a-p15-hist li { margin: 4px 0; }
.a-p15-errs { color: var(--bad); padding-left: 18px; }
.a-p15-cardhead { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.a-p15-cardhead small { display: block; color: var(--muted); }
.a-p15-check { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--gap); align-items: start; }
.a-p15-check .a-card { margin: 0; }
.a-p15-price { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
.a-p15-price dt { color: var(--muted); font-size: 12.5px; }
.a-p15-price dd { margin: 0; font-weight: 700; font-size: 18px; }
.a-p15-steps { padding-left: 20px; margin: 6px 0 0; }
.a-p15-steps li { margin: 6px 0; }
.a-p15-steps b { display: block; }
.a-p15-steps span { color: var(--text-2); }
.a-p15-slabs { }
.adm .a-p15-filters.a-card { padding: 14px 16px; }
.adm .a-p15-slabs.a-card, .adm .a-p15-rates.a-card { padding: 14px 16px; }
.a-p15-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.a-p15-info { background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.a-p15-rates { }
.adm .a-p15-x { border: 0; background: none; padding: 0 0 0 4px; cursor: pointer; font: inherit; color: inherit; }
.a-p15-brand { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--gap); }
.a-p15-btile { display: flex; flex-direction: column; gap: 12px; margin: 0; }
.a-p15-bimg { height: 120px; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(#f2f2f2 0% 25%, #fff 0% 50%) 50% / 16px 16px; border-radius: 8px; border: 1px solid var(--line); }
.a-p15-bimg img { max-width: 90%; max-height: 100px; object-fit: contain; }
.a-p15-favs { display: flex; gap: 12px; align-items: flex-end; }
.a-p15-btxt { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
@media (max-width: 899px) {
  .a-p15-check { grid-template-columns: minmax(0, 1fr); }
  .a-p15-cards { grid-template-columns: minmax(0, 1fr); }
  .a-p15-price { grid-template-columns: minmax(0, 1fr); }
}
/* phase 16: suppliers and buying (v23 section 3 layout), supplier payments */
.a-p16-item { display: inline-flex; gap: 10px; align-items: center; }
/* a table inside a 620 px drawer (v23 drawer tables): tighter cells, quantities and money may wrap, never cut off */
.adm .a-p16-dt th, .adm .a-p16-dt td { padding: 0 14px; white-space: normal; }
.adm .a-p16-dt th { height: 44px; }
.adm .a-p16-dt td { height: 52px; }
.a-p16-dt .a-p16-ic { width: 30px; height: 30px; }
.a-p16-ic { width: 34px; height: 34px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); background: var(--surface-2); }
.a-p16-ic img { width: 100%; height: 100%; object-fit: cover; border-radius: 7px; display: block; } /* phase 18: the pack photo */
.a-p16-ic:has(img) { background: var(--accent-soft, #fdf6dc); border-color: transparent; overflow: hidden; }
.a-p16-tot { max-width: 360px; margin: 12px 0 0 auto; grid-template-columns: 1fr auto; gap: 6px 16px; }
.a-p16-tot dd { text-align: right; }
.a-p16-search { padding: 12px 16px; border-bottom: 1px solid var(--line); }
.a-field-i { display: flex; align-items: center; gap: 8px; min-height: 38px; border: 1px solid var(--line-2); border-radius: var(--r-sm); padding: 0 10px; color: var(--muted); background: var(--surface); max-width: 100%; }
.a-field-i:focus-within { border-color: var(--text); }
.adm .a-field-i input { border: 0; background: transparent; min-height: 36px; padding: 0; box-shadow: none; flex: 1; min-width: 0; color: var(--text); }
.adm .a-field-i input:focus { outline: none; }
.a-p16-nomb { margin-bottom: 0; }
.a-p16-mt0 { margin-top: 0; }
.a-p16-crow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: start; padding: 12px 0; border-bottom: 1px solid var(--line); }
.a-p16-cn { grid-column: 1 / -1; font-size: 13.5px; }
.a-p16-lines { margin: 8px 0 12px; }
/* a line of a buying form in the 620 px drawer (v23 lgrid): the item on its own line, the numbers side by side */
.a-p16-lrow { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); }
.a-p16-lrow > * { flex: 1 1 96px; min-width: 0; }
.a-p16-lrow > .a-wide, .a-p16-lrow > .a-p16-li { flex: 1 1 100%; }
.a-p16-lrow > .a-p16-del { flex: 0 0 38px; }
.a-p16-li { min-width: 0; }
.a-p16-del { margin-top: 24px; }
.a-p16-amt { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; font-size: 13px; }
.a-p16-amt b { font-size: 15px; }
.a-p16-up { color: var(--bad); font-weight: 700; }
.a-p16-calc { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; margin-top: 12px; }
.a-p16-calc .a-p16-tot { margin: 0; max-width: none; }
.a-p16-endbox { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.a-p16-endbox .a-field, .a-p16-endbox .a-grid2 { width: 100%; }
.a-p16-scan { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 8px; }
.a-p16-addrow { display: flex; gap: 8px; align-items: flex-end; margin-top: 8px; }
.a-p16-addrow .a-field { flex: 1; }
.adm .a-p16-late.a-card { padding: 14px 16px; margin-top: var(--gap); }
.adm .a-p16-qcard.a-card { padding: 0; overflow: hidden; }
.a-p16-qcard .a-p15-cardhead { padding: 14px 16px; margin: 0; border-bottom: 1px solid var(--line); }
.a-p16-qcard .a-card { border: 0; border-radius: 0; margin: 0; }
.a-p16-h2 { font-size: 16px; margin: 0; }
.a-p16-qcl { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px; margin-bottom: 12px; }
.a-p16-qch { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.a-p16-f4 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.a-p16-f4 > .a-wide { grid-column: 1 / -1; }
.a-p16-payrow { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 10px; align-items: end; padding: 8px 0; border-bottom: 1px solid var(--line); }
.a-p16-print .a-p16-ph { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.a-p16-print .a-p16-ph b { font-size: 18px; }
.adm .a-p16-print.a-card { padding: 20px; }
@media (max-width: 899px) {
  .a-p16-crow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .a-p16-crow > :first-child { grid-column: 1 / -1; }
  .a-p16-calc, .a-p16-f4, .a-p16-payrow { grid-template-columns: minmax(0, 1fr); }
}
/* phase 17: section 4 Production (Recipes, Production runs, Wastage, production QC) */
.a-p17-pills { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.a-p17-calc { margin-top: 12px; }
.a-p17-used { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
.a-p17-vers { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 899px) {
  .a-p17-used { grid-template-columns: minmax(0, 1fr); }
}
/* phase 18: section 5 Inventory (v23 .filters, .count, .floor) */
.a-p18-filters { padding: 14px 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--line); }
.a-p18-filters select, .a-p18-filters input[type=date] { height: 40px; }
.a-p18-search { display: flex; align-items: center; gap: 8px; height: 40px; border: 1px solid var(--line-2, var(--line)); border-radius: var(--r-sm); padding: 0 11px; background: var(--surface); color: var(--muted); min-width: 0; flex: 1 1 260px; }
.adm .a-p18-search input { border: 0; outline: 0; box-shadow: none; background: none; color: var(--text); min-width: 0; flex: 1; height: 38px; padding: 0; }
.a-p18-count { padding: 10px 16px; font-size: 13.5px; color: var(--muted); border-bottom: 1px solid var(--line); }
.a-p18-floor { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gap); }
.a-p18-floorbtn { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 26px 22px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); text-align: left; cursor: pointer; font: inherit; color: var(--text); min-height: 150px; }
.a-p18-floorbtn:hover { border-color: var(--text-2); }
.a-p18-floorbtn b { font-size: 20px; } .a-p18-floorbtn span { color: var(--muted); font-size: 14.5px; } .a-p18-floorbtn .a-i { width: 30px; height: 30px; }
.a-p18-nowrap { white-space: nowrap; }
.adm .a-p18-cnt input { height: 40px; padding: 0 12px; } /* a count typed in a table row (transfer, stock take): v23 40 px */
/* phase 19: sections 6 and 7 (v23 line editor .lgrid, .calcbox, .meter, the quote print) */
.a-p19-lines { display: flex; flex-direction: column; gap: 10px; margin: 6px 0 12px; }
.a-p19-line { display: grid; grid-template-columns: 40px minmax(0, 3fr) minmax(80px, 1fr) minmax(110px, 1.2fr) auto minmax(80px, auto) 38px; gap: 10px; align-items: end; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.a-p19-pic { align-self: end; padding-bottom: 4px; }
.a-p19-free { height: 40px; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.a-p19-amt { height: 40px; display: flex; align-items: center; justify-content: flex-end; font-weight: 600; font-variant-numeric: tabular-nums; }
.a-p19-why { grid-column: 2 / -1; }
.a-p19-hint { grid-column: 2 / -1; margin: 0; font-size: 13px; color: var(--muted); }
.a-p19-calc { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: var(--gap); align-items: start; margin-top: 8px; }
.a-p19-tot { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.a-p19-tot > div { display: flex; justify-content: space-between; gap: 12px; } .a-p19-tot dt { color: var(--muted); } .a-p19-tot dd { margin: 0; font-variant-numeric: tabular-nums; }
.a-p19-grand { border-top: 1px solid var(--line); padding-top: 6px; font-weight: 700; font-size: 16px; } .a-p19-grand dt { color: var(--text) !important; }
.a-meter { display: block; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; min-width: 60px; }
.a-meter > span { display: block; height: 100%; background: var(--good, #2e7d4f); } .a-meter > span.warn { background: var(--warn, #b7791f); } .a-meter > span.bad { background: var(--bad, #c0392b); }
.a-p19-print { padding: 24px; } .a-p19-ph { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; } .a-p19-ph img { width: 56px; height: 56px; object-fit: contain; }
.a-p19-ph b { display: block; font-size: 18px; } .a-p19-ph span { display: block; color: var(--muted); font-size: 13px; }
.a-p19-kits { margin: 10px 0; } .a-p19-pick { min-width: 260px; flex: 1; }
@media (max-width: 720px) {
  .a-p19-line { grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1fr); }
  .a-p19-item, .a-p19-why, .a-p19-hint { grid-column: 2 / -1; }
  .a-p19-calc { grid-template-columns: minmax(0, 1fr); }
}
/* phase 20: sections 8 and 9 (v23 .scanline, .chkrow, .endbox, .meter in the trip, .chkgrid) */
.a-chkrow { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.a-chkrow input { width: 18px; height: 18px; margin: 0; }
.a-tbad { color: var(--bad); }
.a-act { text-align: right; white-space: nowrap; }
.a-card-h { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.adm .a-card-h h2 { margin: 0; font: 700 var(--fs-h2) var(--font-head); }
.a-p20-card .a-tw { border: 0; border-radius: 0; box-shadow: none; margin: 0; }
.a-p20-card { padding: 0; overflow: hidden; } .a-p20-card + .a-p20-card { margin-top: var(--gap); }
.a-p20-fi { display: inline-flex; align-items: center; gap: 8px; height: var(--ctl); border: 1px solid var(--line-2, var(--line)); border-radius: var(--r-sm); padding: 0 11px; background: var(--surface); color: var(--muted); flex: 0 1 240px; min-width: 0; }
.adm .a-p20-fi select, .adm .a-p20-fi input { border: 0; outline: 0; box-shadow: none; background: none; color: var(--text); min-width: 0; flex: 1; min-height: 0; height: 38px; padding: 0; }
.a-p20-grow { flex: 1 1 auto; }
.a-p20-scan { display: flex; gap: 8px; align-items: center; margin: 4px 0 4px; }
.adm .a-p20-n { width: 84px; flex: 0 0 auto; }
.a-p20-why { margin-top: 6px; } .adm .a-p20-why .a-bad, .adm select.a-bad { border-color: var(--bad); }
.adm .a-p20-why2 { display: block; margin-top: 6px; width: 100%; min-width: 180px; }
.a-p20-mini { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14px; }
.a-p20-give { align-items: end; margin-top: 12px; }
.a-p20-meter { display: inline-block; width: 90px; vertical-align: middle; margin: 0 4px; }
.a-p16-endbox.a-p20-solid { border-style: solid; }
.a-p20-load { display: flex; gap: 8px; width: 100%; align-items: center; } .adm .a-p20-load select { flex: 1; min-width: 0; }
.a-p20-ro { margin: 0; min-height: var(--ctl); display: flex; flex-direction: column; justify-content: center; }
.a-p20-ctl { min-height: var(--ctl); }
.a-p20-days { display: flex; flex-wrap: wrap; gap: 8px 16px; padding-top: 6px; }
.a-p20-match { display: block; margin: 4px 0; }
.adm .a-table th.a-p20-tick, .adm .a-table td.a-p20-tick { width: 60px; min-width: 60px; max-width: 60px; box-sizing: border-box; } /* v23 To pick: the tick column (44px + padding) */
.adm .a-p20-danger { color: var(--bad); border-color: var(--bad-line, var(--bad)); }
@media (max-width: 720px) {
  .a-p20-scan { flex-wrap: wrap; } .a-p20-scan .a-p20-grow { flex: 1 1 100%; }
  .a-p20-fi { flex: 1 1 100%; }
}
/* phase 21: sections 10 and 11 (v23 totals box, .endbox, the money summary row, print views) */
.a-p21-tot { max-width: 360px; margin: 12px 0 0 auto; display: flex; flex-direction: column; gap: 6px; }
.a-p21-tot > div { display: flex; justify-content: space-between; gap: 16px; } .a-p21-tot dt { color: var(--muted); } .a-p21-tot dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
.a-p21-tot .a-p21-tb { border-top: 1px solid var(--line); padding-top: 6px; font-size: 15px; }
.a-p21-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.a-p21-end { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.a-p21-end .a-field, .a-p21-end .a-grid2, .a-p21-end .a-alert { width: 100%; } .a-p21-end.a-p21-dash { border-style: dashed; }
.a-p21-h3 { font-size: 15px; margin: 16px 0 6px; } .a-p21-mini { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14px; }
.a-p21-brk { overflow-wrap: anywhere; word-break: break-all; } .a-p21-sm { font-size: 12px; }
.a-p21-demo { background: var(--bad-bg, #fdf1f1); color: var(--bad); padding: 6px 10px; font-weight: 700; margin-bottom: 12px; border-radius: var(--r-sm); }
.a-p21-qr { display: flex; gap: 12px; align-items: center; margin: 8px 0; } .a-p21-qr p { margin: 0; } .a-p21-qr svg { width: 110px; height: 110px; }
.a-p21-print .a-table { margin-top: 10px; } .a-p21-print .a-kv { margin-top: 8px; }
.a-p21-sum { margin-bottom: var(--gap); } /* v23: the "Customers owe" row is a one-row table in a card */
.a-p21-fcard { padding: 0; overflow: hidden; } .a-p21-fcard .a-p18-filters { border-bottom: 0; } /* v23 .card > .filters */
.a-p21-nowrap { white-space: nowrap; } .a-p21-pad { padding: 0 16px 12px; margin: 0; }
.a-p21-line { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 12px; align-items: start; margin: 8px 0; }
.a-p21-card { padding: 0; overflow: hidden; margin-top: var(--gap); } .a-p21-card .a-table { margin: 0; }
.a-p21-ch { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); } .a-p21-ch h2 { font-size: 16px; margin: 0; }
/* phase 23: petty cash boxes, alerts list, dashboard tiles */
.a-bars { display: flex; align-items: flex-end; gap: 10px; height: 200px; padding: 10px 4px 0; } .a-bar { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; }
.a-bar i { display: block; width: 100%; max-width: 42px; border-radius: 6px 6px 2px 2px; background: var(--accent); } .a-bar i.neg { background: var(--bad); } .a-bar span { font-size: 11px; color: var(--muted); text-align: center; word-break: break-word; } .a-bar em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--text-2); }
.a-stat.a-stat-card { padding: 18px 20px; margin-bottom: 0; } .a-card-b { padding: 20px; } .a-card-h .a-sp { flex: 1; } .a-p23-full .a-tw { max-height: none; } .a-card-h p { margin: 2px 0 0; font-size: 13px; color: var(--text-2); }
.a-p23-loved { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; } .a-p23-loved .it { text-align: center; font-size: 13px; font-weight: 600; line-height: 1.3; cursor: pointer; border-radius: 10px; padding: 6px; } .a-p23-loved .it:hover { background: var(--surface-2); }
.a-p23-loved img, .a-p23-loved .a-p23-noimg { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); margin-bottom: 6px; display: block; height: auto; }
.a-p23-loved .n { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: #121214; font-size: 11px; margin-bottom: 4px; }
@media (max-width: 600px) { .a-p23-loved { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.a-p23-two { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; } @media (max-width: 900px) { .a-p23-two { grid-template-columns: minmax(0, 1fr); } }
.a-btn.a-p23-more { border-color: transparent; background: none; } .a-btn.a-p23-more:hover { background: var(--surface-2); }
.a-p23-kit { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; margin-top: 8px; cursor: pointer; } .a-p23-kit img { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; } .a-p23-kit b { display: block; } .a-p23-kit span.s { font-size: 13px; color: var(--text-2); }
.a-p23-gh { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); margin: 20px 0 6px; } .a-p23-towns { display: flex; flex-wrap: wrap; gap: 6px; }
.a-card > .a-p23-filters, .a-card-b > .a-p23-filters { margin: 0; gap: 16px 18px; } .a-p23-filters + .a-hint-s { margin: 8px 0 0; } .a-p23-long .a-stat-tx b { font-size: 22px; line-height: 1.25; }
.a-p23-ic.a-tone-good { background: var(--good-bg); color: var(--good); } .a-p23-ic.a-tone-bad { background: var(--bad-bg); color: var(--bad); } .a-p23-ic.a-tone-warn { background: var(--warn-bg); color: var(--warn); } .a-p23-ic.a-tone-info { background: var(--info-bg); color: var(--info); } .a-p23-ic.a-tone-gold { background: var(--accent-soft); color: #8a6d00; }
.a-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 16px; align-items: end; margin: 12px 0; }
.a-p23-box { margin-bottom: var(--gap); } .a-p23-box h3 { margin: 0; }
.a-p23-al { display: flex; align-items: center; gap: 12px; } .a-p23-al > .a-p23-ic { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.a-p23-unread b { font-weight: 700; } .a-p23-read b { font-weight: 500; } .a-p23-read { opacity: .8; }
.a-p23-tile { cursor: pointer; text-align: left; border: 0; background: none; padding: 0; width: 100%; font: inherit; color: inherit; } .a-p23-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 12px; }
@media (max-width: 900px) { .a-grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .a-grid4 { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 720px) {
  .a-p21-line { grid-template-columns: minmax(0, 1fr) 96px; }
  .a-p21-card { overflow-x: auto; }
}
@media print {
  body:has(#printArea) * { visibility: hidden; }
  body:has(#printArea) #printArea, body:has(#printArea) #printArea * { visibility: visible; }
  body:has(#printArea) #printArea { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; border: 0; }
}
@media print {
  body.a-printing-card * { visibility: hidden; }
  body.a-printing-card .a-printonly-area, body.a-printing-card .a-printonly-area * { visibility: visible; }
  body.a-printing-card .a-printonly-area { position: absolute; left: 0; top: 0; width: 100%; }
}
`;

export default css;
