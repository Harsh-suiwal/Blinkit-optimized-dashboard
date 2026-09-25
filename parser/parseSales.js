const XLSX = require('xlsx');

const REQUIRED_COLUMNS = [
  'Order Id',
  'Order Date',
  'Product Name',
  'Brand Name',
  'Customer City',
  'Quantity',
  'Total Gross Bill Amount',
];

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Reads sales_summary.xlsx - one row per order line item - and returns
 * clean row objects. Unlike the inventory report, this file has a single
 * header row at the top, so no header-row hunting is needed.
 */
function parseSalesRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) {
    throw new Error('The uploaded sheet has no data rows.');
  }

  const headerRow = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(`Missing expected column(s): ${missing.join(', ')}`);
  }

  return rows
    .filter((r) => r['Order Id'] !== '' && r['Order Id'] !== undefined)
    .map((r) => ({
      orderId: String(r['Order Id']).trim(),
      orderDate: String(r['Order Date']).trim(),
      productName: String(r['Product Name'] || '').trim(),
      brandName: String(r['Brand Name'] || '').trim(),
      customerCity: String(r['Customer City'] || 'Unknown').trim(),
      quantity: toNumber(r['Quantity']),
      revenue: toNumber(r['Total Gross Bill Amount']),
    }));
}

/**
 * Aggregates order-level rows into one row per city: total revenue,
 * total units, order count and average order value.
 */
function aggregateByCity(salesRows) {
  const byCity = new Map();

  for (const row of salesRows) {
    if (!byCity.has(row.customerCity)) {
      byCity.set(row.customerCity, {
        city: row.customerCity,
        revenue: 0,
        units: 0,
        orderIds: new Set(),
        products: new Map(), // productName -> { revenue, units }
        brands: new Set(),
      });
    }
    const c = byCity.get(row.customerCity);
    c.revenue += row.revenue;
    c.units += row.quantity;
    c.orderIds.add(row.orderId);

    if (row.brandName) c.brands.add(row.brandName);

    if (row.productName) {
      if (!c.products.has(row.productName)) {
        c.products.set(row.productName, { revenue: 0, units: 0 });
      }
      const p = c.products.get(row.productName);
      p.revenue += row.revenue;
      p.units += row.quantity;
    }
  }

  return Array.from(byCity.values()).map((c) => {
    // "Best" = highest revenue product in that city.
    let topProduct = null;
    let topProductRevenue = 0;
    for (const [name, stats] of c.products) {
      if (stats.revenue > topProductRevenue) {
        topProduct = name;
        topProductRevenue = stats.revenue;
      }
    }

    return {
      city: c.city,
      revenue: Math.round(c.revenue * 100) / 100,
      units: c.units,
      orderCount: c.orderIds.size,
      avgOrderValue: c.orderIds.size > 0 ? Math.round((c.revenue / c.orderIds.size) * 100) / 100 : 0,
      topProduct,
      topProductRevenue: Math.round(topProductRevenue * 100) / 100,
      brands: Array.from(c.brands),
    };
  });
}

/**
 * Aggregates order-level rows into one row per product: total revenue,
 * total units sold, order count, and a per-city breakdown. This powers
 * the product-centric "focus" view, which needs to show how a single
 * product is doing across cities rather than how a city is doing
 * across products.
 */
function aggregateByProduct(salesRows) {
  const byProduct = new Map();

  for (const row of salesRows) {
    if (!row.productName) continue;

    if (!byProduct.has(row.productName)) {
      byProduct.set(row.productName, {
        productName: row.productName,
        brandName: row.brandName || '',
        revenue: 0,
        units: 0,
        orderIds: new Set(),
        cities: new Map(), // city -> { revenue, units, orderIds }
      });
    }
    const p = byProduct.get(row.productName);
    p.revenue += row.revenue;
    p.units += row.quantity;
    p.orderIds.add(row.orderId);

    if (!p.cities.has(row.customerCity)) {
      p.cities.set(row.customerCity, { revenue: 0, units: 0, orderIds: new Set() });
    }
    const c = p.cities.get(row.customerCity);
    c.revenue += row.revenue;
    c.units += row.quantity;
    c.orderIds.add(row.orderId);
  }

  return Array.from(byProduct.values())
    .map((p) => {
      const cities = Array.from(p.cities.entries())
        .map(([city, stats]) => ({
          city,
          revenue: Math.round(stats.revenue * 100) / 100,
          units: stats.units,
          orderCount: stats.orderIds.size,
          avgOrderValue: stats.orderIds.size > 0 ? Math.round((stats.revenue / stats.orderIds.size) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      return {
        productName: p.productName,
        brandName: p.brandName,
        revenue: Math.round(p.revenue * 100) / 100,
        units: p.units,
        orderCount: p.orderIds.size,
        avgOrderValue: p.orderIds.size > 0 ? Math.round((p.revenue / p.orderIds.size) * 100) / 100 : 0,
        topCity: cities[0] ? cities[0].city : null,
        cities,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Ranks cities by revenue and tags each as 'top' (top 25%), 'low'
 * (bottom 25%) or 'mid'. This works even on the very first upload,
 * before there's any history to compare trends against.
 */
function assignPerformanceTiers(cityRows) {
  const sorted = [...cityRows].sort((a, b) => b.revenue - a.revenue);
  const n = sorted.length;
  const topCutoff = Math.max(1, Math.ceil(n * 0.25));
  const lowCutoff = Math.max(1, Math.ceil(n * 0.25));

  const tierByCity = new Map();
  sorted.forEach((row, idx) => {
    let tier = 'mid';
    if (idx < topCutoff) tier = 'top';
    else if (idx >= n - lowCutoff) tier = 'low';
    tierByCity.set(row.city, tier);
  });

  return cityRows.map((row) => ({ ...row, tier: tierByCity.get(row.city) }));
}

module.exports = { parseSalesRows, aggregateByCity, aggregateByProduct, assignPerformanceTiers, toNumber };
