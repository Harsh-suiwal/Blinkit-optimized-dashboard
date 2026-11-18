// Strategy tab: the BASE PLAN, written by hand. No AI touches this file.
// Source: brand-strategy/base-strategy-playbook.md v1.0 (Parts 1, 2, 4, 5). Change the strategy by editing this file only.
//
// Tick ids ("p3.2", "g.M1") are saved per brand. Keep an id stable once used; add new items with new ids.
// `from` names the dashboard facts shown under a pillar (see brandFacts in routes/strategy.js). A fact the
// dashboard does not have is simply left out, never guessed.

const PILLARS = [
  {
    id: 'p0', title: 'Product truth and compliance',
    why: 'The product must be legal to sell, its claims true, its specs listed correctly. Do this first.',
    musts: [
      'Check the category rules (blade size for knives, FSSAI for food, BIS where needed).',
      'Make sure every claim on the listing can be proven.',
      'Get the brand’s confirmation in writing for anything doubtful.',
    ],
    stop: 'Any doubt about compliance: stop all ads until it is resolved.',
    from: ['compliance'],
  },
  {
    id: 'p1', title: 'Know the buyer and buying situations',
    why: 'Brands grow by reaching more buyers. People enter a category through situations, not demographics.',
    musts: [
      'List 2 to 4 buyer groups.',
      'List 5 to 8 buying situations (why, when, where, while, with whom, with what, how feeling).',
      'Pick the 3 most common, least contested situations to own.',
      'Write one line of reason to buy for each buyer group.',
    ],
    from: ['cities', 'topProducts'],
  },
  {
    id: 'p2', title: 'Retail-ready product page',
    why: 'Fix the shelf before buying traffic. Otherwise ads pay for visitors who do not buy.',
    musts: [
      'Image 1: product only, plain background, no text.',
      'Then images for key features, use case, who uses it, comparison with others, size and specs.',
      'Title: Brand + product type (main keyword) + key feature + material/size + use. Main keyword early.',
      'Description: first line says what it is and who it is for, then 4 to 6 benefit points, then specs and what is in the box.',
      '15+ reviews and 4 stars or more before scaling ads. Read 1 to 2 star reviews for fixes.',
      'Price sits inside the category price band; any premium is explained on the page.',
    ],
    from: ['listing', 'price'],
  },
  {
    id: 'p3', title: 'Physical availability (stock where demand is)',
    why: 'On quick commerce, availability means in stock at the nearby dark store and visible in search.',
    musts: [
      'Keep stock in hand at 2x the last 30 days of units (about 60 days of cover). Reorders take 15+ days.',
      'Never run ads on a product or city that is out of stock.',
      'Build stock 15+ days before known peaks.',
      'Add cities only when stock can follow.',
    ],
    from: ['stock'],
  },
  {
    id: 'p4', title: 'Hero SKU and price ladder',
    why: 'One or two products carry the brand; everything else supports them.',
    musts: [
      'Name the hero (best mix of sales and repeat).',
      'Build a ladder: trial (low-price entry), hero, bundle or combo, premium or gift.',
      'Drop or fix products that do not move.',
    ],
    from: ['hero', 'topProducts'],
  },
  {
    id: 'p5', title: 'Search and ads structure',
    why: 'Keep four campaign buckets apart so each one can be judged on its own.',
    musts: [
      'Brand: the brand’s own name. Cheap, protects existing demand.',
      'Category: what the product is (knife, kitchen knife).',
      'Use-case: the buying situations (chicken cutting knife, meat cutter).',
      'Competitor and discovery: broad match to find new search terms. Small budget.',
      'Start at the platform’s suggested bid. Decide nothing on a keyword before about 10 clicks.',
      'Every week: move winning search terms to exact match, add wasters as negatives.',
      'Start with 1 or 2 hero products in 1 or 2 strong cities. Scale only after 4 weeks of stable ROAS.',
    ],
    stop: 'Do not read ROAS on MRP, and do not run ads on out-of-stock items.',
    from: ['ads', 'organic', 'adBudget'],
  },
  {
    id: 'p6', title: 'Brand memory (distinctive look)',
    why: 'Every change resets memory. Consistency over years beats a new look each month.',
    musts: [
      'Fix one look (colours, logo position, image style, one tagline).',
      'Use it on every image, banner and pack.',
      'Keep showing the product inside its buying situations.',
    ],
    from: [],
  },
  {
    id: 'p7', title: 'Repeat and reviews',
    why: 'Reviews and repeat buyers make the same traffic convert better.',
    musts: [
      'Ask early buyers for honest reviews (never fake ones).',
      'For consumables, track and grow repeat. For durables, grow gifting, sets and word of mouth.',
    ],
    from: ['listing'],
  },
  {
    id: 'p8', title: 'Profit discipline',
    why: 'A sale that loses money does not get better when you scale it.',
    musts: [
      'Know profit after ads for each product (Profit tab).',
      'Push ads only on products with positive profit after ads.',
      'Prefer bundles to flat discounts. Set a floor price.',
    ],
    from: ['margin'],
  },
  {
    id: 'p9', title: 'Weekly rhythm',
    why: 'The base only works if it runs every week.',
    musts: [
      'Weekly: check hero stock, mine search terms, adjust bids, read new reviews.',
      'Monthly: month-by-month review, update hero, price and pack decisions, write down what you learned.',
      'Quarterly: refresh buying situations and creatives (same look), review city expansion.',
    ],
    from: ['trend'],
  },
];

// 6-month plan. Do not start the next month until the gate is ticked.
const PLAN = [
  { id: 'M1', title: 'Fix the shelf', focus: 'Compliance, listing, stock',
    actions: ['Compliance check.', 'Image stack, title formula, description.', 'Build 60 days of cover on the hero.', 'Brand campaign plus a small use-case campaign in the top 1 or 2 cities.'],
    gate: 'Listing complete, hero in stock, first reviews coming.' },
  { id: 'M2', title: 'Learn', focus: 'Keywords and bids',
    actions: ['Run the 4 campaign buckets.', 'Weekly search-term mining.', 'Apply the 10-click rule.', 'Add negatives.'],
    gate: '5 to 10 proven keywords with ROAS above break-even.' },
  { id: 'M3', title: 'Prove', focus: 'Hero and ladder',
    actions: ['Push budget to proven terms.', 'Add a trial or combo product.', 'Collect reviews.'],
    gate: 'Stable ROAS for 4 weeks and profit after ads positive.' },
  { id: 'M4', title: 'Expand cities', focus: 'Physical availability',
    actions: ['Add 2 to 4 cities with demand where stock can follow.', 'Copy winning keywords into them.'],
    gate: 'New cities reach 70% of the old cities’ ROAS within 4 weeks.' },
  { id: 'M5', title: 'Peak and season', focus: 'Demand moments',
    actions: ['Pre-build stock 15+ days ahead.', 'Festive keywords and bundles.', 'Raise bids on proven terms only.'],
    gate: 'Peak sales without running out of stock.' },
  { id: 'M6', title: 'Review and scale', focus: 'Scale what works',
    actions: ['Roll out to all Blinkit cities with stock.', 'Write down what you learned.', 'Plan the next 6 months.', 'Consider the add-ons.'],
    gate: 'Learnings written down and next-6-month targets set.' },
];

// Optional add-ons (playbook Part 5). `needs`: auto = judged by the app from a health pill or a ticked gate; text-only = you judge it.
const MODULES = {
  A1: { name: 'Festive and seasonal calendar', use: 'The category has clear peaks (Dhanteras, Diwali, Rakhi, summer, winter).', needs: [{ text: 'Stock planning working.', pill: 'stock' }] },
  A2: { name: 'Trend and viral-moment response', use: 'A trend or customer post fits the product.', needs: [{ text: 'Listing ready.', pill: 'listing' }, { text: 'Stock buffer.', pill: 'stock' }, { text: 'A fast approval path.' }] },
  A3: { name: 'Creator and influencer seeding', use: 'The product is visual or easy to demo.', needs: [{ text: 'Reviews at 4 stars or more.', pill: 'listing' }, { text: 'Brand look fixed.', tick: 'p6.1' }] },
  A4: { name: 'Multi-platform expansion (Zepto, Instamart, Flipkart Minutes)', use: 'The Blinkit hero is proven.', needs: [{ text: 'Base green on Blinkit for 2+ months (gates M1 to M3 ticked).', tick: 'g.M3' }] },
  A5: { name: 'Packs, combos and gift sets', use: 'Basket or price fit is weak, or gifting demand exists.', needs: [{ text: 'A clear hero.', pill: 'hero' }, { text: 'Margin known.', pill: 'margin' }] },
  A6: { name: 'Competitor conquesting', use: 'The category leader is beatable on price or quality.', needs: [{ text: 'Strong listing and reviews.', pill: 'listing' }] },
  A7: { name: 'Banners, brand store and video ads', use: 'Building brand memory in key cities.', needs: [{ text: 'Brand look fixed.', tick: 'p6.1' }, { text: 'Budget beyond search.' }] },
  A8: { name: 'Off-platform demand (Instagram and Meta ads to Blinkit)', use: 'Awareness is needed beyond in-app search.', needs: [{ text: 'Stock in the target cities.', pill: 'stock' }] },
  A9: { name: 'Price and promo experiments', use: 'Price sensitivity is unknown.', needs: [{ text: 'Floor price set.' }] },
  A10: { name: 'New product launch test', use: 'The brand wants to add a product.', needs: [{ text: 'A stable hero.', pill: 'hero' }, { text: 'Launch in 1 or 2 cities first.' }] },
};

/** Every tick id the plan knows, so the server can drop anything else. */
function allTickIds() {
  const ids = [];
  for (const p of PILLARS) p.musts.forEach((_, i) => ids.push(`${p.id}.${i + 1}`));
  for (const m of PLAN) ids.push(`g.${m.id}`);
  return ids;
}

/** The plan as plain text, for the optional AI box (replaces the empty strategy/playbook.md). */
function planAsText() {
  const lines = ['BASE STRATEGY (fixed, do not change it; only add brand-specific wording).', ''];
  for (const p of PILLARS) {
    lines.push(`## ${p.title}`, p.why, ...p.musts.map((m) => `- ${m}`), ...(p.stop ? [`STOP: ${p.stop}`] : []), '');
  }
  lines.push('6-MONTH PLAN');
  for (const m of PLAN) lines.push(`${m.id} ${m.title} (${m.focus}). Gate: ${m.gate}`);
  return lines.join('\n');
}

module.exports = { PILLARS, PLAN, MODULES, allTickIds, planAsText };
