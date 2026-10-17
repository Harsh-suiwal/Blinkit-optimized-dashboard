// Maps the exact column headers from Blinkit's "Stock On Hand" export
// to our internal field names. If Blinkit renames a column, update it here only.
//
// The source sheet has TWO header rows: a group row (Product details,
// Warehouse details, ...) and the real column row underneath it. We only
// need the real column row - parseReport.js finds it automatically by
// looking for "Item ID".

module.exports = {
  // Product details
  'Item ID': 'itemId',
  'Item Name': 'productName',
  'Brand Name': 'brandName',
  'UPC': 'upc',
  'UoM': 'uom',

  // Warehouse details
  'Warehouse Facility ID': 'warehouseId',
  'Warehouse Facility Name': 'warehouseName',

  // Incoming inventory
  'Net scheduled inventory': 'netScheduledInventory',
  'Incoming scheduled inventory': 'incomingScheduledInventory',
  'Recalled inventory': 'recalledInventory',

  // Sellable inventory
  'Total sellable': 'totalSellable',
  'Warehouse': 'sellableWarehouse',
  'In-between': 'sellableInBetween',
  'Darkstore': 'sellableDarkstore',

  // Unsellable inventory
  'Total unsellable': 'totalUnsellable',
  'Damaged': 'damaged',
  'Lost': 'lost',
  'Expired': 'expired',
  'Near Expiry': 'nearExpiry',

  // Units sold (pre-aggregated by Blinkit as of report date)
  'Last 7 days': 'unitsSold7',
  'Last 15 days': 'unitsSold15',
  'Last 30 days': 'unitsSold30',

  'Remarks': 'remarks',
};

// Required columns - if any of these are missing from the uploaded file,
// we stop and show a clear error instead of a broken dashboard.
module.exports.REQUIRED_RAW_COLUMNS = [
  'Item ID',
  'Item Name',
  'Warehouse Facility ID',
  'Warehouse Facility Name',
  'Net scheduled inventory',
  'Incoming scheduled inventory',
  'Total sellable',
  'Last 7 days',
  'Last 15 days',
  'Last 30 days',
];

// --- Campaign (Blinkit ad export: one row per day x campaign x targeting) ---
// The workbook has two sheets with different layouts. The type is detected
// from the header row, not the sheet name (Blinkit has used both
// PRODUCT_BOOSTING and PRODUCT_LISTING for the first one).
const CAMPAIGN_COMMON_COLUMNS = {
  'Date': 'date',
  'Campaign ID': 'campaignId',
  'Campaign Name': 'campaignName',
  'Targeting Type': 'targetingType',
  'Pacing Type': 'pacingType',
  'CPM': 'cpm',
  'Impressions': 'impressions',
  'Direct ATC': 'directAtc',
  'Indirect ATC': 'indirectAtc',
  'Direct Quantities Sold': 'directQtySold',
  'Indirect Quantities Sold': 'indirectQtySold',
  'Direct Sales': 'directSales',
  'Indirect Sales': 'indirectSales',
  'New Users Acquired': 'newUsersAcquired',
  'Estimated Budget Consumed': 'estimatedBudgetConsumed',
  'Direct RoAS': 'directRoas',
  'Total RoAS': 'totalRoas',
};

module.exports.CAMPAIGN_PB_COLUMNS = {
  ...CAMPAIGN_COMMON_COLUMNS,
  'Targeting Value': 'targetingValue',
  'Match Type': 'matchType',
  'Most Viewed Position': 'mostViewedPosition',
};

module.exports.CAMPAIGN_RC_COLUMNS = { ...CAMPAIGN_COMMON_COLUMNS };

module.exports.REQUIRED_CAMPAIGN_PB_COLUMNS = [
  'Date', 'Campaign ID', 'Campaign Name', 'Targeting Type', 'Targeting Value',
  'Impressions', 'Estimated Budget Consumed', 'Direct Sales', 'Indirect Sales',
];

module.exports.REQUIRED_CAMPAIGN_RC_COLUMNS = [
  'Date', 'Campaign ID', 'Campaign Name', 'Targeting Type',
  'Impressions', 'Estimated Budget Consumed', 'Direct Sales', 'Indirect Sales',
];
