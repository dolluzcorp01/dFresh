# 01 - Project brief (plain words)

Source documents: `docs/reference/dFresh_Website_Developer_Brief_v0.2.pdf`, `docs/reference/dFresh_Website_Product_List_v0.2.xlsx`.
Approved design: `docs/reference/dfresh-preview-v3.html`.

## The business
- dFresh is a tissue and hygiene paper brand of Dolluz Corporation (OPC) Pvt Ltd, stocked at a godown in **Kanchipuram**, office at **Padur**.
- Range at launch: **25 products in 6 categories** (+ 3 colour variants of DZIND-DF008):
  Table Napkins 7 · Toilet & Washroom Rolls 6 · Kitchen Towels 2 · Facial Tissue 5 · Hand Towels 4 · Wet Wipes 1.
- Tagline: **Gentle, Like You**.

## What the website must do (Phase 1)
A catalogue and lead website. **No prices. No online payment.** Every visit should end in one of:
1. a **WhatsApp chat** (button on every screen, pre-filled message),
2. a **quote or free-sample request**,
3. a **gated brochure download** (name, e-mail, mobile first),
4. a **distributor application**, or
5. a **contact message**.

## Audiences
- **Businesses**: hotels & lodges, restaurants & caterers, offices & factories, hospitals & clinics in
  Kanchipuram, Vellore, Wallajabad, Ambur, Sriperumbudur and Chennai.
- **Distributors**: towns outside our own sales beats.
- **Homes**: families, shops; build trust in a premium-looking brand at a fair, local price.

## Languages
English (default) + Tamil + Hindi at launch. Telugu / Kannada when we enter Andhra / Karnataka.
Arabic (right-to-left) only if we export to the Gulf. **Adding a language must not need a redesign or code change.**

## Where leads go
Every form submission: saved in MySQL -> e-mailed to `info@dolluzcorp.com` -> appended to one Google Sheet
(one tab per form). Visitor sees a thank-you with a WhatsApp button.

## Must-haves from the brief (summary - full detail in 05_FEATURES_SPEC.md)
- WhatsApp everywhere, +91 93302 59330, with pre-filled messages per page / product / kit.
- Flip cards for products (3 photos auto-scrolling, Know more -> details on the back). No product detail pages.
- Home shows the 5 featured products; one products view shows all 25 with category filters and search.
- Gated brochure download; brochure per language (English first, Tamil / Hindi later).
- Lead forms: Quote / sample, Distributor, Brochure (+ Contact form added in preview v3).
- Language switcher top right that remembers the choice. Banner headlines are HTML text, not baked into images.
- Right click, copy and image download disabled.
- Fast on 4G (< 3 s), Lighthouse >= 85, GA4 events, Search Console, hreflang, schema.org, XML sitemap.
- Privacy policy (DPDP Act 2023), consent on every form, no selling of data.
- A CMS that Dolluz staff can use without a developer (our admin console, Phase 7).
- Domain, hosting, Google and WhatsApp accounts in Dolluz's name.

## Not on the site yet
Client logos, testimonials, certifications (ISO / BIS / FSC), claims like "medical grade", "100% eco-friendly",
"bamboo range", public prices.

## Later phases (design for them, do not build them now)
- Phase 2 of the business: washroom calculator, distributor / shop map with shop list.
- Phase 3: B2B re-order portal, consumer online shop (payments).

## People
- Shoban - owner / product decisions (emp_id DZIND002)
- Pavithran - developer (emp_id DZIND148)
- Ashwini Kumar - Director, final sign-off on design, content and go-live
