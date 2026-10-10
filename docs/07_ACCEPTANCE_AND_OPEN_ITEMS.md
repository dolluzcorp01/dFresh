# 07 - Acceptance checklist and open items

## Go-live acceptance (brief section 6, plus our additions) - verify each by USING the site, not by tests
- [ ] All 25 products load from the database with 3 photos each; flip works on desktop and mobile (touch).
- [ ] DZIND-DF008 shows White / Black / Burgundy / Lavender; each swaps photos, ID, text and WhatsApp message.
- [ ] 5 featured products on Home in featured order; "See all products" opens the products view.
- [ ] Filters show correct counts (All 25, For Home 10, 7/6/2/5/4/1); search finds by name, ID and size ("30x30").
- [ ] EN / TA / HI switch works on every section, card, form, error, banner, map label and footer; choice remembered.
- [ ] A test language added in admin (inactive -> translated -> active) appears everywhere without a deploy.
- [ ] WhatsApp button on every screen with the right pre-filled message (general / product / variant / kit).
- [ ] Brochure form validates, downloads the right-language PDF (English fallback), e-mails a copy link, records the lead.
- [ ] Quote, sample, distributor and contact forms validate, save, e-mail info@dolluzcorp.com and append to the Google Sheet tab.
- [ ] With SendGrid / Google disabled, leads still save and the outbox shows them pending; re-enabling sends them.
- [ ] Right click, copy, image drag / save blocked outside form fields.
- [ ] No prices, no unapproved claims anywhere.
- [ ] Mobile load < 3 s on 4G; Lighthouse mobile >= 85 in all four categories (attach the report).
- [ ] hreflang, canonical, JSON-LD validate (Rich Results Test); sitemap.xml lists every language URL.
- [ ] Privacy policy (DPDP) and Terms complete and approved; consent recorded on every lead.
- [ ] Footer complete: company, CIN, GSTIN, Padur office, Kanchipuram godown, phones, e-mail.
- [ ] Reduced-motion mode: site fully usable, nothing auto-moves.
- [ ] Keyboard only: every button, card flip, swatch, form and the drawer usable; focus always visible.
- [ ] Admin: login (password + code), roles enforced server-side, every change in the audit log.
- [ ] No long dash characters anywhere in the code base or content.

## Open items (need Dolluz / Director input) - do not invent answers
| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | Domain (brief: dfresh.com not owned; staging URL until confirmed) and public e-mail on the site | Dolluz | Phase 8 go-live |
| 2 | GSTIN | Dolluz | footer, terms |
| 3 | Brochure PDFs (English first, then Tamil, Hindi) | Dolluz | brochure download (lead still saved meanwhile) |
| 4 | Exact office and godown addresses / Google Maps pins | Dolluz | contact maps, JSON-LD |
| 5 | GA4 measurement id + Search Console access | Dolluz | analytics |
| 6 | Google Sheet + service account for leads | Dolluz | sheet sync (outbox keeps rows meanwhile) |
| 7 | Verified SendGrid sender for dFresh mail: `mail_from` = `connect@dolluzcorp.com` (owner, Phase 6). Confirm it is verified in SendGrid + the production API key; first real test send only to the approved test inbox | Dolluz IT | all e-mail |
| 8 | Register app_key `dFresh` in dAdmin. Checked 2026-10-10: not in `dadmin.login_app_config` or `app_visibility`. Sign-in does NOT need it (dFresh uses login_otp + login_session_revoke, free-text app_key); the rows only make dFresh show in dAdmin's screens. SQL in deploy/DEPLOY.md section 3 | Pavithran | none (dAdmin screens) |
| 9 | Native-speaker review of all Tamil and Hindi text | Dolluz | go-live |
| 10 | Approve About copy, Quality-check wording, Privacy and Terms drafts | Director | go-live |
| 11 | Approve or drop the funky / neon / rainbow banners (seeded inactive) | Director | none |
| 12 | Final product specs after supplier samples (all specs are "planned") | Dolluz | updated Excel import |
| 13 | Missing Appendix of 25 reference websites in the brief PDF | Dolluz | none (design approved via preview) |
| 14 | Staff WhatsApp alert for new leads needs WhatsApp Business API; Phase 1 = e-mail alert only | Dolluz | none |
| 15 | Confirm dev/prod API port 4012 is free on the droplet | Pavithran | Phase 0 |
| 16 | Lighthouse mobile >= 85 - NOT MET locally. Phase 8 final (production build + gzip like nginx, Windows, 3 runs, median): /en perf 62, /en/products 61, /ta 49; accessibility / best practices / SEO 100 on all three (was /en perf 51, a11y 95 before Phase 8). Left: render delay of a client-rendered page (LCP 3.5-5 s) and main-thread work at load (TBT 0.5-2.7 s, hero WebGL sheet + petals + roll / map / ring setup, web-font swaps). Next levers need a decision: pre-render the hero HTML on the server, start the hero animations after load, self-host the fonts. Re-measure on PageSpeed Insights after the staging deploy before deciding | Pavithran / Shoban | go-live |
| 17 | ~~First real admin sign-in~~ DONE 2026-10-10: DZIND148 signed in with password + e-mailed code (mail_outbox #11 sent, audit_log #1 `login`) | Pavithran | - |
| 18 | Public `/languages` and `/bootstrap` are cached by browsers (`max-age=60, stale-while-revalidate=600`): a language switched off (or any admin edit) can still show to a visitor who loaded the site in the last minute, longer while the stale copy revalidates. The server side changes at once. Accept, or shorten the max-age | Shoban | none |
| 19 | Rich Results Test: Product items in the JSON-LD have no offers / price (Phase 1 rule), and Google's Product snippet needs offers, review or aggregateRating, so the test will list them as "not eligible" (Organization / LocalBusiness are fine; the schema is valid). Accept until prices exist, or drop the ItemList from the JSON-LD. Needs a public URL to run at all (after staging deploy) | Shoban | none |
| 20 | DZIND-DF048 "Bamboo Facial Tissue" ("made from bamboo pulp") comes from Dolluz's product list v0.2, but the brief bars "bamboo" claims until confirmed in writing. Confirm the material (or rename / deactivate it in the admin) | Dolluz | go-live |
| 21 | `site_settings.site_url` is seeded `https://dfresh.in` ("TO CONFIRM"); no code reads it. Set it to the real domain with the rest of the `<DOMAIN>` list (deploy/DEPLOY.md section 1) | Pavithran | none |

