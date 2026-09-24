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
