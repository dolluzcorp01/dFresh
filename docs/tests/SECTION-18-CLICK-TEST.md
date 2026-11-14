# Section 18 - Website pages: click test

For Pavithran, before Shoban freezes section 18 (the last section before go-live). Click every step by hand on the
stage2 admin and on the public site, and tick it. Each step says what to do and what you should see. If you see
something else, write down the step number and what happened, and stop there.

The spec is the owner's field map (`docs/claude-tasks/done/phase-24-field-map.md`, 102 rows). The row numbers are in
brackets.

## Before you start

- Use the stage2 admin. Sign in as **Pavithran** (Admin). For the second-Admin steps you need **Shoban** (Admin) in a
  second browser.
- Keep the public site open in a third tab (`/en`); after a save, reload it (the site shows a change on the next load).
- Mail stays off on stage2 test runs; no step here sends mail.

## Part A - Home page

1. **Website > Home page > Banners.** Subtitle "Sliding photos on the home page". The list has a "Shows" column:
   "Always", or the days and "Showing", "Not yet" or "Ended". (10)
2. Open a banner. Below the note: **Show from** and **Show until** (date pickers). Set Show until before Show from.
   Show until is marked "On or after Show from"; Save is refused with the same words. (10)
3. Set Show from = tomorrow, Save. Reload `/en`: the banner is gone. Clear both dates, Save: it is back. (10)
4. In "Text per language", the row **Photo description**. Type one in English, Save. On `/en` the banner photo has
   that text as its alt text (right click is blocked: check with the browser's Inspect). (11)
5. **Home doors.** Two cards, For Home and For Business: the picture (product picker with photos) and **Where it
   goes**. For Home = "Products, For Home filter"; For Business = "A home page section" / "For Business". (12, 13, 15)
6. Change For Home to "A category" / Napkins, Save. On `/en` the For Home door opens the products drawer on Napkins.
   Put it back to "Products, For Home filter". (15)
7. Below: **Door headings and texts (per language)**, ten rows (doors_k ... db_go) in English, Tamil, Hindi. Change
   one word, Save texts. Open Translations: the same key shows the new word. Put it back. (14)
8. **Most loved.** "Selected (in order)" with the ticked products, drag to reorder; the list below to tick more. The
   hint says every ticked product shows (no limit). Tick one more, Save: `/en` shows it in the row. Untick it, Save.
   (16, 17, 18)
9. Below: **Section heading and words**, the featured texts per language. (19)
10. **Size picker** and **Kits on the site**: as before (product photo on every product line). Size picker
    subtitle says "'Roll it out' is fixed". (20 to 30)

## Part B - Brochures and forms

11. **Website > Brochures.** At the top, the switch **brochure_download_enabled**. Turn it off: on `/en` the brochure
    button is gone everywhere. Turn it on again. The table: file, size, uploaded by and date, read only. (31 to 33)
12. **Forms > Form options**: as before. (34 to 38)
13. **Forms > Form rules.** Four cards: Brochure form, Quote form (also Sample), Distributor form, Contact form. Each
    field: Required tick, Longest text, Check. Phone is ticked, greyed, "Always required ... (read only)". (39 to 64)
14. Untick **Town** in the Quote form. A toast says it is optional now. On `/en` open the quote form: Town has no
    star; send it without a town: accepted. Tick Town again. (46)
15. **Limits**: Spam limit (from 1 to 20) and Most products in one quote (1 to 100). Type 21, Save limits: "A whole
    number from 1 to 20". Put 5 back. (67, 68)
16. The **Read only** box: the longest text is set by the database; the e-mail, mobile and GST checks with their
    rules. (65, 66)
17. **Error messages (per language)**: e_fill ... e_rate, editable, same rows as Translations. (69)

## Part C - Where we deliver map (one town list)

18. **Website > Where we deliver map.** The box "One town list" with a link to Delivery areas. The map preview with
    every town; the table: order, name on the map (Godown base pill), delivery area ("map only" for Wallajabad and
    Ambur), pin, Show on map tick. (70 to 75)
19. Open Kanchipuram: names per language, the map with the pin (drag it, or the name), Map x / y, name offsets and
    alignment, Godown base, Latitude / Longitude (base only). Close without saving: "Discard unsaved changes?". (70 to 73)
20. **Masters > Delivery areas**: add an area "Uthiramerur", PIN 603406, Show on map off. Back on the map page it is
    under "Delivery areas not on the map". Tick it, open it, give it a name and a pin, Save: `/en` shows it under the
    map. Untick it again. (75)
21. Drag a town to another place, Save order: the names under the map on `/en` follow. (74)

## Part D - Brand and layout

22. **Menu links.** Six rows: Products, For Business, Where we deliver, The range (footer only), About, Contact (no
    footer). Columns Header, Phone menu, Footer, Shown. (76, 80)
23. Untick **Shown** on About. On `/en` About is gone from the header, the phone menu and the footer. Tick it again.
    (78)
24. Drag Where we deliver to the top, Save order: first in all three menus. Put it back. (77)
25. Open a link: Name per language, Goes to (One of our pages / A home page section), Which one. There is no box
    for a web address. A built-in link has no Delete button. (79, 81)
26. **Visit cards.** Padur office and Kanchipuram godown, with address, phone, opening hours, Shown. (82, 86)
27. **Add a card**, then **Fill from a godown**: pick Bengaluru. The English name, address and hours fill in, the
    phone too, and the map location; "Later changes on Godowns do not change this card". Click **Check on the map**:
    the small Google map shows the place. Add. `/en` shows a third card in the Contact section. (84, 85, 87, 88)
28. Delete that added card (built-in cards cannot be deleted). (85)

## Part E - Google and sharing, Site settings

29. **Google and sharing.** Website address, read only, "set on the server". Below: site_indexing, share_image,
    ga4_measurement_id. (90 to 93)
30. Turn **Show in Google (indexing)** off: a warning "Hide the site from Google?" first. Cancel. (91)
31. **Page titles and descriptions (per page, per language)**: every seo_ text (home, products, each category,
    privacy, terms). (89)
32. **Site settings.** "Company details on the site": company name, CIN, GSTIN, phone, e-mail, WhatsApp, greyed, each
    "Changed on Admin > Company" with a link. (94, 95)
33. **lead_email**: type a new address, Save. The message says it waits for a second Admin; the row shows "Waiting
    for a second Admin" with a link to Approvals. As Shoban, approve it in Approvals: the row shows the new address.
    Put the old one back the same way. (97)
34. **gsheet_spreadsheet_id**: the same, waits for a second Admin. Open sheet and Test connection still work. (100)
35. **mail_from**: a list of the verified SendGrid senders, no typing; when SendGrid cannot be read it says so and the
    saved sender stays. **mail_from_name**: typed, saved at once. (98)
36. **mail_logo_url** (preview, Send test mail) and **about_image** (upload, focus point): as before. (96, 99)
37. **two_step_login**: On or Off, read only, "Switched on Admin > Users and security". (101)
38. **WhatsApp button greeting (per language)**: wa_general, editable. (102)
39. **Admin > Users and security > Staff**, at the bottom: **Two-step sign-in** with the switch. Turn it off: the
    dialog says a second Admin must approve; after "Ask to turn off" it shows "Waiting for a second Admin". As Shoban,
    approve it: Off. Turn it on again with the e-mailed code (only where mail is on). (101)

## Part F - Old links and languages

40. Open `/admin/settings`: it goes to Site settings. `/admin/settings#setting-ga4_measurement_id` goes to Google and
    sharing; `/admin/towns` goes to Where we deliver map.
41. Every page above at phone width (390): no sideways scroll; the tables scroll inside their card.
42. Add a fourth language on Languages (switch it on): every per-language table on these pages gets a column for it,
    with no code change. Switch it off again.
