// The numbers of the Listing table (Profit tab) and the report's "Catalogue and fee structure" section.
// Pure: no database. Everything is per ONE unit sold at the typed selling price (what the customer pays, GST included).
//
//   discount %        = (MRP - selling price) / MRP
//   GST               = selling price - selling price / (1 + GST %)
//   commission        = selling price x commission %        (the same rule the Profit maths uses)
//   Blinkit fees      = commission + fulfilment + inward     (storage is left out: it depends on how long a unit sits)
//   fees % of price   = Blinkit fees / selling price
//   left after fees   = selling price - GST - Blinkit fees   (still before product cost, ads and other expenses)
//
// Commission is "known" only when it was typed (or came from a cost sheet), or when the brand's default commission is
// above 0. A default of 0 means "not entered yet", never "free", so the fee figures stay empty instead of looking cheap.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * input: { mrp, sellingPrice, commissionPct, commissionKnown, taxPct, inward, fulfilment } (numbers or null).
 * Returns { hasPrice, discountPct, gstValue, commissionValue, feesValue, feesPct, leftValue }; a figure is null when its inputs are missing.
 */
function listingFigures(input) {
  const { mrp, sellingPrice, commissionPct, commissionKnown, taxPct, inward, fulfilment } = input;
  const out = { hasPrice: false, discountPct: null, gstValue: null, commissionValue: null, feesValue: null, feesPct: null, leftValue: null };
  if (!isNum(sellingPrice) || sellingPrice <= 0) return out;
  out.hasPrice = true;
  if (isNum(mrp) && mrp > 0) out.discountPct = r1(((mrp - sellingPrice) / mrp) * 100);
  const tax = isNum(taxPct) ? taxPct : 0;
  out.gstValue = r2(sellingPrice - sellingPrice / (1 + tax / 100));
  if (!commissionKnown || !isNum(commissionPct)) return out;
  const commission = (sellingPrice * commissionPct) / 100;
  const fees = commission + (isNum(inward) ? inward : 0) + (isNum(fulfilment) ? fulfilment : 0);
  out.commissionValue = r2(commission);
  out.feesValue = r2(fees);
  out.feesPct = r1((fees / sellingPrice) * 100);
  out.leftValue = r2(sellingPrice - out.gstValue - fees);
  return out;
}

module.exports = { listingFigures };
