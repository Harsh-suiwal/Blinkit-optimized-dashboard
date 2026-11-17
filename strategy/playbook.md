# Brand Strategist Playbook — Base Strategy + Advanced Modules

**Purpose:** This is the "brain" for the dashboard's Strategy tab. The AI reads this file plus one brand's data and writes that brand's strategy.
**Version:** 1.0 · 14 Nov 2026 · Faucek Product Dashboard
**Design rule:** The **Base Strategy** (Parts 1–4) is built on long-proven buyer-behaviour laws and retail basics, so it should not need changing for 4–5 years. Anything that moves fast (bid prices, platform features, trends) lives only in **Part 6 (Benchmarks)** and **Part 5 (Advanced modules)**, which can be updated without touching the base.

---

## Part 0 — How the tool uses this file

**Inputs**
1. Brand + product(s) selected in the dashboard.
2. Data source (user picks one):
   - **Raw Blinkit sheets**: the original uploaded sheets.
   - **Dashboard data**: the same numbers the dashboard shows and exports as CSV.
   - **Both**: use both and point out where they disagree.
3. Manual inputs (the data does not contain these): current title, description, number of images, price/MRP, rating and review count, target cities, monthly ad budget, product specs (e.g., blade length for knives).
4. Advanced modules the user ticked (Part 5). None ticked = base only.

**Output modes**
- **Full report**: every Base section, then the ticked modules.
- **Talking points**: 8–12 short points for a client meeting. Each point says what we found, what we'll do, and what it should achieve.

**Rules for the AI**
- Use the brand's own numbers wherever possible and say which data source each number came from.
- Never invent numbers. If data is missing, say "needs input" and give the safe default from this playbook.
- Mark every assumption as an assumption.
- Diagnose before prescribing: run the Health Scorecard (Part 3) first, then give advice in the order the scorecard says is most urgent.
- The base strategy is the same for every brand; only the specifics (users, keywords, numbers) change.
- Recompute ROAS on net selling value, never MRP.

---

## Part 1 — The laws that don't change (why the base works)

These come from decades of buyer research, mainly the Ehrenberg-Bass Institute (*How Brands Grow*, Byron Sharp; Jenni Romaniuk), Binet & Field's IPA effectiveness work, and retail-readiness practice on marketplaces. They hold across countries, including India.

1. **Brands grow by getting more buyers, not by making existing buyers more loyal.** Small brands have fewer buyers, and those buyers are slightly less loyal ("double jeopardy"). So the first job is reaching more category buyers.
2. **Two things drive growth:**
   - **Mental availability:** the brand comes to mind in buying situations.
   - **Physical availability:** the brand is easy to find and buy.
   On quick commerce, physical availability means in stock at the nearby dark store **and** visible in search.
3. **Buying situations, not demographics.** People enter a category through situations called Category Entry Points (CEPs), e.g., "cutting chicken at home on Sunday." Find them with the 7 W's: Why, When, Where, While, With whom, With what, hoW feeling. Link the brand to several of them.
4. **Be distinctive and consistent.** Keep the same colours, logo, pack look and image style everywhere for years. Every change resets memory.
5. **Brand building and sales activation both matter.** Over the long run the best results come from about 60% brand building and 40% short-term activation. The exact split varies by category and stage, so treat it as a direction, not a law.
6. **Fix the shelf before buying traffic (retail readiness).** Title, images, description, ratings and reviews, price and stock must be right *before* ads. Otherwise ads pay for visitors who don't buy.
7. **Promotions shift sales; they don't build brands.** Use discounts sparingly: for trial, for gaining distribution, or for festive peaks. Never make them permanent.
8. **Profit is designed, not hoped for.** Track contribution margin per product and channel. A sale that loses money doesn't get better when you scale it.

---

## Part 2 — The Base Strategy (every brand, every time)

Ten pillars. For each one: **what it means**, a **must-do checklist**, **what the dashboard measures**, and **red flags**.

### Pillar 0 — Product truth & compliance gate (do this first)
- **Means:** the product is legal to sell on the platform, its claims are true, and specs are listed correctly.
- **Must-do:**
  - Check category rules: blade sizes for knives, FSSAI for food, BIS where needed, and the claims you're allowed to make.
  - Make sure every claim on the listing can be proven.
- **Red flag:** any doubt about compliance. Stop all ads until it's resolved.
- *Example (knives):* In Feb 2026, Delhi Police booked Blinkit under the Arms Act over knives above the permitted size. The seized item was a folding/button knife. Reports cite limits of 7.62 cm blade length and 1.72 cm width, and kitchen/utility knives are argued under different terms. **Get the brand's legal/compliance confirmation before pushing "heavy duty" knives.**

### Pillar 1 — Know the buyer and the buying situations
- **Means:** who buys the category, and when, where and why they think of it.
- **Must-do:**
  - List 2–4 buyer groups.
  - List 5–8 buying situations (CEPs) using the 7 W's.
  - Pick the 3 most common, least contested situations to own.
  - Write a one-line reason to buy for each buyer group.
- **Dashboard:** cities and months that sell most, and product mix.
- **Red flag:** "everyone" as the target, or one narrow niche only.

### Pillar 2 — Retail-ready product page (the digital shelf)
- **Image stack, in order:**
  1. Clean product only, plain background, **no text**.
  2. Key features (3–4 callouts).
  3. Use case: the product in action.
  4. Who uses it: buyer groups and situations.
  5. Why it's better than others: a simple comparison.
  6. Size, specs and what's in the box.
  7. (Optional) Trust: warranty, material proof, reviews.
- **Image callouts** carry the main search phrases (e.g., "meat cutter knife", "premium wooden handle").
- **Title formula:** `Brand + Product type (main keyword) + Key feature + Material/Size + Use`. Put the main keyword early. Keep it clear and readable, not stuffed.
- **Description:** first line answers "what is it and who is it for". Then 4–6 benefit points, each carrying a secondary keyword naturally. Then specs, care instructions, and what's in the box.
- **Ratings and reviews:** aim for 15–20+ reviews and 3.5★+ (4★+ is better) before scaling ads. Read the 1–2★ reviews for fixes and for keywords.
- **Price:** sits clearly within the category's price band. Any premium must be explained on the page.
- **Red flags:** text on the first image, blurry images, title missing the main keyword, rating under 3.5★, no reviews.

### Pillar 3 — Physical availability (stock where demand is)
- **Rule (already in the dashboard):** keep stock in hand ≥ 2× the last 30 days' units (about 60 days of cover). Reorders take at least 15 days, so urgency starts below that.
- **Must-do:**
  - Never run ads on a product or city that's out of stock.
  - Build stock 15+ days before known peaks.
  - Expand cities only when stock can follow.
- **Dashboard:** Stock tab status, Incoming, and the surge flag.
- **Red flags:** a hero SKU low or out of stock, or ads spending in out-of-stock cities.

### Pillar 4 — Hero SKU and price/pack ladder
- **Means:** one or two products carry the brand. Everything else supports them.
- **Must-do:**
  - Name the hero (best mix of sales, margin and repeat).
  - Build a ladder: **Trial** (low-price entry), **Hero**, **Bundle/Combo** (raises basket value), **Premium/Gift**.
  - Drop or fix SKUs that don't move.
- **Dashboard:** sales by product, share of revenue, month-by-month.
- **Red flags:** sales spread thinly across many SKUs, or no clear hero.

### Pillar 5 — Search & ads base structure
- **Four campaign buckets, kept separate:**
  1. **Brand:** the brand's own name. Cheap, protects existing demand.
  2. **Category/Generic:** what the product is (e.g., "knife", "kitchen knife").
  3. **Use-case/Need:** the buying situations (e.g., "chicken cutting knife", "meat cutter").
  4. **Competitor/Discovery:** competitor names and broad/smart match to find new search terms. Small budget.
- **Keyword method:**
  - Start from the CEPs (Pillar 1) and real search words, including Hinglish.
  - Proven terms go into tight exact-match groups.
  - Discovery runs broad.
  - Every week, move winning search terms into exact and add wasters as negatives.
  - Keep brand terms negative in non-brand campaigns so the reports stay clean.
- **Bidding basics:**
  - Start at the platform's suggested bid; current ranges are in Part 6.
  - Bid highest on proven high-intent exact terms, lower on discovery.
  - **Decide nothing on a keyword before ~10 clicks.**
  - Raise bids on terms with good net ROAS and stock. Lower or pause the rest.
- **Budget basics:** start with 1–2 hero SKUs in 1–2 strong cities. Scale only after 4 weeks of stable net ROAS.
- **Measure:** spend, net ROAS, ATC, orders, new-to-brand where available, and organic vs paid sales.
- **Red flags:**
  - ROAS read on MRP.
  - Paid sales rising while organic falls (ads covering up a weak listing).
  - Ads running on out-of-stock items.

### Pillar 6 — Brand memory (distinctive assets)
- **Must-do:**
  - Fix one look (colour, logo position, image style, one tagline) and use it on every image, banner and pack for years.
  - Keep showing the product inside its buying situations.
- **Balance:** on the platform most spend is activation (search ads). Off-platform and banners build the brand. As the brand grows, move toward the long-run brand/activation balance in Part 1.
- **Red flag:** a different look on every creative.

### Pillar 7 — Repeat and reviews
- **Must-do:**
  - Get reviews from early buyers (honest asks only, never fake reviews).
  - For consumables, track and grow repeat.
  - For durables like knives, grow gifting, sets and word of mouth.
- **Dashboard:** unique orders vs units; repeat rate if customer data exists.
- **Benchmark:** brands that last usually show repeat above ~35–40% in consumable categories.

### Pillar 8 — Profit discipline
- **Must-do:**
  - Know contribution margin per SKU: net sales − COGS − platform fees − storage − GST effect − ads.
  - Push ads only on SKUs with positive margin after ads.
  - Prefer bundles to flat discounts.
  - Set a floor price.
- **Dashboard:** Profit tab (COGS, storage, GST, include ad spend).
- **Red flags:** negative margin after ads, or growth coming only from discounts.

### Pillar 9 — Weekly operating rhythm (how the base runs)
- **Weekly:**
  - Check stock on hero SKUs.
  - Mine search terms (promote winners, add negatives).
  - Adjust bids.
  - Read new reviews.
- **Monthly:**
  - Month-by-month review.
  - Update the hero, price and pack decisions.
  - Write learnings to the log (Part 8).
- **Quarterly:**
  - Refresh buying situations and creatives, keeping the same look.
  - Review city expansion.

---

## Part 3 — Health Scorecard (the AI fills this first)

| Area | Green | Amber | Red | Source |
|---|---|---|---|---|
| Compliance | Confirmed OK | Unchecked | Doubt or violation | Manual input |
| Hero stock cover | ≥ 60 days in hand | 15–60 days | < 15 days or OOS | Stock tab |
| Listing readiness | Image stack + title formula + ≥15 reviews + ≥4★ | Partly done | First image has text / <3.5★ / no reviews | Manual input |
| Hero concentration | Top SKU clear, ladder exists | Hero unclear | Sales spread thin, no hero | Sales |
| Ads efficiency (net ROAS) | Above brand's break-even ROAS | Near break-even | Below break-even | Advertising + Profit |
| Organic vs paid | Organic stable or rising | Flat | Organic falling while paid rises | Sales + Advertising |
| Trend | Month-on-month growth | Flat | Decline 2+ months | Trends / Month-by-month |
| Margin after ads | Positive | ~0 | Negative | Profit tab |

**Break-even ROAS = 1 ÷ (contribution margin % before ads).** Example: 40% margin → break-even ROAS 2.5.

**Fix order:** Red items, in this order: Compliance → Stock → Listing → Margin → Ads → Growth.

---

## Part 4 — Base 6-month India plan (with gates)

Each month has a **gate**. Don't move to the next month until the gate is passed.

| Month | Focus | Actions | Gate to move on |
|---|---|---|---|
| **M1 — Fix the shelf** | Compliance, listing, stock | Compliance check; image stack; title formula; description; build 60-day cover on hero; brand campaign + small use-case campaign in the top 1–2 cities | Listing complete, hero in stock, first reviews coming |
| **M2 — Learn** | Keywords and bids | Run 4 buckets; weekly search-term mining; 10-click rule; negatives | 5–10 proven keywords with net ROAS above break-even |
| **M3 — Prove** | Hero + ladder | Push budget to proven terms; add trial or combo SKU; collect reviews | Stable net ROAS for 4 weeks; margin after ads positive |
| **M4 — Expand cities** | Physical availability | Add 2–4 cities where Blinkit has demand and stock can follow; copy winning keywords | New cities at ≥70% of the old cities' ROAS within 4 weeks |
| **M5 — Peak/season** | Demand moments | Pre-build stock 15+ days ahead; festive keywords and bundles; raise bids on proven terms only | Peak sales without running out of stock |
| **M6 — Review & national** | Scale what works | Roll out to all Blinkit cities with stock; review learnings; plan next 6 months; consider Advanced modules | Learnings logged; next-6-month targets set |

---

## Part 5 — Advanced modules (optional, switched on per brand)

These are add-ons. The tool shows them as tick boxes. Each one lists **when to use it** and **prerequisites**: don't run a module until the Base is green on its prerequisites.

| # | Module | Use when | Prerequisite |
|---|---|---|---|
| A1 | **Festive & seasonal calendar** | Category has clear peaks (Dhanteras, Diwali, Rakhi, summer, winter) | Stock planning working |
| A2 | **Trend / viral-moment response** | A trend or customer post fits the product | Listing ready, stock buffer, fast approval path |
| A3 | **Creator & influencer seeding** | Product is visual or demo-friendly | Reviews ≥4★, distinct look fixed |
| A4 | **Multi-platform expansion** (Zepto, Instamart, Flipkart Minutes, Amazon Now) | Blinkit hero proven | Base green on Blinkit for 2+ months |
| A5 | **Q-comm packs, combos, gift sets** | Basket or price fit is weak, or gifting demand exists | Hero clear, margin known |
| A6 | **Competitor conquesting** | Category leader is beatable on price or quality | Strong listing and reviews |
| A7 | **Banners, brand store, video ads** | Building brand memory in key cities | Distinctive look fixed, budget beyond search |
| A8 | **Off-platform demand** (Meta/Instagram ads pointing to Blinkit) | Need awareness beyond in-app search | Stock in target cities |
| A9 | **Price & promo experiments** | Price sensitivity unknown | Floor price set |
| A10 | **New product launch test** | Brand wants to add a SKU | Hero stable; launch in 1–2 cities first, scale on repeat/velocity |

---

## Part 6 — Benchmarks (dated; update these, not the base)

*Last checked: Nov 2026. Agency and industry estimates, so treat them as starting points and replace them with the brand's own data as soon as it exists.*

- **Blinkit sponsored product clicks:** about ₹3–10 CPC.
- **Homepage banners:** about ₹150–300 CPM.
- **Brand store:** minimum about ₹1 lakh.
- **Starter test budget** commonly reported: ₹25,000–50,000. Listing fee about ₹25,000 per SKU per state, credited to the ad wallet. Some sources report ₹2–3 lakh minimum monthly ad spend for larger programs.
- **Blinkit Product Booster:** keyword or category targeting; suggested bids shown; smart match; negative keywords; Bid Booster up to +50%.
- **Visibility ROAS reported by agencies:** home essentials ~3–4.5×, gourmet F&B ~3.8–5.5×, health ~4–6×.
- **Q-comm ad conversion:** ~3–8%.
- **Festive peaks:** ad rates up ~40–50%; q-comm orders ~+85–105% YoY in festive weeks.
- **Impulse price points:** ₹49 / ₹99 / ₹149 / ₹199 / ₹299. Conversion drops sharply above ~₹500. Typical basket ₹350–700.
- **Blinkit Kitchen & Dining:** ~4,500 products (June 2026); most priced ₹160–359.
- **Platform reporting:** Zepto and Instamart report ROAS on MRP, so recompute on net.

---

## Part 7 — Output templates

### Full report
1. Snapshot (data source used, period, key numbers)
2. Health Scorecard (Part 3) + top 3 problems
3. Buyers & buying situations
4. Product page fixes (images, title, description, reviews, price)
5. Keywords (4 buckets + negatives)
6. Campaigns & starting bids
7. Stock plan
8. Hero & ladder
9. 6-month plan (Part 4, filled with this brand's specifics)
10. Profit check (break-even ROAS, margin after ads)
11. Ticked Advanced modules
12. Assumptions & inputs needed

### Talking points (meeting)
8–12 points, each one line. Order: biggest problem → quick wins → 6-month direction → what we need from the brand.

---

## Part 8 — Learnings log (how the tool "learns")

After each month, the team saves entries like this:

`Brand | Category | Date | What we did | Result (numbers) | Keep / Drop | Note`

The AI reads past entries for the **same category first**, then for other categories, and uses them to adjust its advice. It must say when advice comes from a past learning.

---

## Part 9 — Worked example: Oicia Heavy-Duty Knife (pilot)

*Numbers to be filled from Oicia's data once loaded.*

- **Pillar 0:** confirm blade length/width and type (fixed kitchen blade, not folding) against the rules; confirm with the brand in writing. Avoid "weapon-like" wording.
- **Buyers:** (1) non-veg households who cut chicken, mutton or fish at home; (2) home chefs and cooking enthusiasts; (3) small eateries, dhabas and cloud kitchens; (4) gifting (housewarming, Diwali kitchen upgrade).
- **Buying situations:** Sunday or festival meat cooking; bought meat that's not cut small enough; old knife went blunt or broke; setting up a new kitchen; Bakrid/Eid; Diwali kitchen upgrade.
- **Images:**
  1. Knife alone, no text.
  2. Thick steel blade, wooden handle grip, weight/balance.
  3. Cutting chicken or mutton through bone.
  4. Home cook + chef.
  5. Vs regular kitchen knife (thickness, grip, durability).
  6. Size and care.
- **Title draft:** `Oicia Heavy Duty Meat Cleaver Knife – Stainless Steel Blade, Premium Wooden Handle – for Chicken, Mutton & Bone Cutting`
- **Keywords:**
  - **Brand:** oicia, oicia knife.
  - **Category:** knife, kitchen knife, big knife, chopper.
  - **Use-case:** meat cutting knife, chicken cutting knife, mutton knife, cleaver, bone cutting knife, butcher knife.
  - **Feature:** wooden handle knife, heavy duty knife, steel knife.
  - **Hinglish:** chaku, bada chaku, chopper chaku.
  - **Negatives to test:** toy, paper cutter, folding, pocket.
- **Ladder:** Trial = small utility knife; Hero = heavy-duty cleaver; Bundle = cleaver + vegetable knife (+ sharpener); Gift = boxed set for Diwali or housewarming.
- **Plan:** follow Part 4. Ticked modules likely A1 (festive) and A5 (combos/gift sets).

---

## Sources
- Ehrenberg-Bass / Byron Sharp, *How Brands Grow* — summaries: https://www.supersummary.com/how-brands-grow/summary/ · https://learn.zappi.io/article/336-principles-of-how-brands-grow · https://sharley.substack.com/p/summary-how-brands-grow-part-2-by
- Category Entry Points (Jenni Romaniuk): https://www.marketingweek.com/ehrenberg-bass-category-entry-points · https://www.quantilope.com/cep-generator
- Binet & Field, *The Long and the Short of It*: https://www.alexmurrell.co.uk/summaries/les-binet-and-peter-field-the-long-and-the-short-of-it · https://www.warc.com/en/article/how-do-i-balance-short--and-long-term-marketing-needs%3F-fd5984b050d945a48ec78ba360ae9ea1
- Retail readiness: https://feedvisor.com/resources/amazon-marketing-advertising-strategies/what-is-amazon-retail-readiness/ · https://www.channelengine.com/retail-readiness-on-amazon-vendor · https://myamazonguy.com/amazon-retail-readiness-11-steps/
- Search campaign structure: https://searchads.apple.com/best-practices/campaign-structure · https://www.sellerlabs.com/?p=17992 · https://clicksgeek.com/?p=23006
- Blinkit ads: https://paxcom.ai/blog/getting-started-with-blinkit-ads/ · https://swcybernetics.in/guides/blinkit-advertising · https://unicommerce.com/?p=444561 · https://lyxelandflamingo.com/?p=125922
- Blinkit listing: https://swcybernetics.in/knowledge-base/blinkit-onboarding-process-2026
- Kitchen & Dining on Blinkit: https://metricscart.com/quick-commerce-analytics/reports/blinkit/kitchen-dining-on-blinkit/
- Knife case (Arms Act): https://www.millenniumpost.in/delhi/cops-book-blinkit-for-sale-of-prohibited-knives-648836 · https://thepatriot.in/?p=82613
- Phase 1 market research: brand-strategy/brand-growth-research.md (this project)