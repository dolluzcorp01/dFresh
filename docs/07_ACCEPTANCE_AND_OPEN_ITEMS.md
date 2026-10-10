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
| 8 | Register app_key `dFresh` in dAdmin (login_otp / login config / revoke) | Pavithran | admin login |
| 9 | Native-speaker review of all Tamil and Hindi text | Dolluz | go-live |
| 10 | Approve About copy, Quality-check wording, Privacy and Terms drafts | Director | go-live |
| 11 | Approve or drop the funky / neon / rainbow banners (seeded inactive) | Director | none |
| 12 | Final product specs after supplier samples (all specs are "planned") | Dolluz | updated Excel import |
| 13 | Missing Appendix of 25 reference websites in the brief PDF | Dolluz | none (design approved via preview) |
| 14 | Staff WhatsApp alert for new leads needs WhatsApp Business API; Phase 1 = e-mail alert only | Dolluz | none |
| 15 | Confirm dev/prod API port 4012 is free on the droplet | Pavithran | Phase 0 |
| 16 | Lighthouse mobile >= 85 - measured 66 median locally (unreliable Windows runs; Phase 2 shell = 88). Hard gate in Phase 8, verified on PageSpeed Insights after staging deploy. | Pavithran | Phase 8 |
| 17 | First real admin sign-in (dAdmin password + e-mailed code): Claude has no dAdmin password, so Phase 7 tested sessions, roles and the code checks with signed test sessions only. Sign in once with a real account and confirm the code e-mail arrives (MAIL_TEST_TO redirects it locally) | Pavithran | admin login |
| 18 | Public `/languages` and `/bootstrap` are cached by browsers (`max-age=60, stale-while-revalidate=600`): a language switched off (or any admin edit) can still show to a visitor who loaded the site in the last minute, longer while the stale copy revalidates. The server side changes at once. Accept, or shorten the max-age | Shoban | none |
