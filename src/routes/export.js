// ═══════════════════════════════════════════════════════════════════
// src/routes/export.js
// Excel Export Route
//
// Generates a professional .xlsx workbook that mirrors the exact
// structure Microsoft Access would expect for import, with:
//
//   Sheet 1 — Orders        (one row per order, all financials)
//   Sheet 2 — Customers     (one row per customer, full history)
//   Sheet 3 — Order Items   (every line item, FK to Orders sheet)
//
// The workbook is styled to open cleanly in both Excel and Access:
//   • Frozen header rows
//   • Auto-fit column widths
//   • Number/currency/date formats
//   • Alternating row shading
//   • A summary sheet with totals
//
// Endpoints:
// ──────────
//   GET /api/export/excel   → download full workbook as .xlsx
// ═══════════════════════════════════════════════════════════════════
'use strict';

const router   = require('express').Router();
const ExcelJS  = require('exceljs');
const db       = require('../db/database');


// ── Shared style helpers ─────────────────────────────────────────

/** Header cell style — dark background, white bold text */
const HEADER_STYLE = {
  font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' },
  fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } },
  alignment: { vertical: 'middle', horizontal: 'center', wrapText: false },
  border: {
    bottom: { style: 'medium', color: { argb: 'FF444444' } },
  },
};

/** Alternating row fill — very light grey for even rows */
const ROW_EVEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
const ROW_ODD_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

/** Number formats */
const FMT_CURRENCY = '"EGP "#,##0.00';
const FMT_DATE     = 'YYYY-MM-DD';
const FMT_NUMBER   = '#,##0.000';

/**
 * applyHeaderRow(row)
 * Apply the dark header style to every cell in the given row.
 */
function applyHeaderRow(row) {
  row.height = 22;
  row.eachCell(cell => { Object.assign(cell, HEADER_STYLE); cell.style = { ...HEADER_STYLE }; });
}

/**
 * applyDataRow(row, rowIndex)
 * Apply alternating fill to a data row.
 */
function applyDataRow(row, rowIndex) {
  row.height = 18;
  const fill = rowIndex % 2 === 0 ? ROW_EVEN_FILL : ROW_ODD_FILL;
  row.eachCell({ includeEmpty: true }, cell => {
    cell.fill = fill;
    cell.font = { name: 'Calibri', size: 10 };
    cell.alignment = { vertical: 'middle' };
  });
}

/**
 * freezeAndFilter(sheet, row, cols)
 * Freeze the first `row` rows and add AutoFilter on the header row.
 */
function freezeAndFilter(sheet, row = 1, cols) {
  sheet.views = [{ state: 'frozen', ySplit: row }];
  sheet.autoFilter = { from: { row, column: 1 }, to: { row, column: cols } };
}


// ─────────────────────────────────────────────────────────────────
// GET /api/export/excel
// Build and stream the full workbook.
// ─────────────────────────────────────────────────────────────────
router.get('/excel', async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();

    // Workbook metadata
    wb.creator  = 'Bahr Coffee Store POS';
    wb.created  = new Date();
    wb.modified = new Date();
    wb.properties.date1904 = false;

    // ── Fetch all data from SQLite ────────────────────────────────

    const orders = db.all(`
      SELECT
        o.id          AS "Order ID",
        o.invoice     AS "Invoice",
        o.date        AS "Date",
        c.name        AS "Customer Name",
        c.mobile      AS "Mobile",
        c.address     AS "Address",
        o.payment     AS "Payment Method",
        o.notes       AS "Notes",
        COALESCE(SUM(CASE WHEN oi.unit='kg' THEN oi.quantity ELSE 0 END),0) AS "Total Weight (kg)",
        o.subtotal    AS "Subtotal (EGP)",
        o.tax_rate    AS "Tax Rate (%)",
        o.tax_amount  AS "Tax Amount (EGP)",
        o.total       AS "Total (EGP)",
        o.created_at  AS "Created At"
      FROM orders o
      JOIN customers   c  ON c.id  = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.id DESC
    `);

    const customers = db.all(`
      SELECT
        c.id          AS "Customer ID",
        c.name        AS "Name",
        c.mobile      AS "Mobile",
        c.address     AS "Address",
        COUNT(o.id)               AS "Total Orders",
        COALESCE(SUM(
          CASE WHEN oi.unit='kg' THEN oi.quantity ELSE 0 END
        ),0)                      AS "Total Weight (kg)",
        COALESCE(SUM(o.total),0)  AS "Total Spent (EGP)",
        c.created_at  AS "Customer Since"
      FROM customers c
      LEFT JOIN orders     o  ON o.customer_id = c.id
      LEFT JOIN order_items oi ON oi.order_id  = o.id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    const items = db.all(`
      SELECT
        oi.id         AS "Item ID",
        oi.order_id   AS "Order ID",
        o.invoice     AS "Invoice",
        o.date        AS "Order Date",
        c.name        AS "Customer",
        oi.name_ar    AS "Product (Arabic)",
        oi.name_en    AS "Product (English)",
        oi.unit       AS "Unit",
        oi.quantity   AS "Quantity",
        oi.price      AS "Unit Price (EGP)",
        oi.line_total AS "Line Total (EGP)"
      FROM order_items oi
      JOIN orders    o ON o.id = oi.order_id
      JOIN customers c ON c.id = o.customer_id
      ORDER BY oi.order_id DESC, oi.id
    `);


    // ══════════════════════════════════════════════════════════════
    // SHEET 1 — ORDERS
    // ══════════════════════════════════════════════════════════════
    const wsOrders = wb.addWorksheet('Orders', {
      pageSetup:  { paperSize: 9, orientation: 'landscape', fitToPage: true },
      properties: { tabColor: { argb: 'FF111111' } },
    });

    if (orders.length > 0) {
      const orderCols = Object.keys(orders[0]);

      // Column definitions with widths
      wsOrders.columns = orderCols.map(key => ({
        header: key,
        key,
        width: Math.max(key.length + 4, _guessWidth(key)),
      }));

      // Style header
      applyHeaderRow(wsOrders.getRow(1));

      // Data rows
      orders.forEach((row, i) => {
        const r = wsOrders.addRow(Object.values(row));
        applyDataRow(r, i);

        // Apply currency format to financial columns
        ['Subtotal (EGP)', 'Tax Amount (EGP)', 'Total (EGP)'].forEach(col => {
          const colIdx = orderCols.indexOf(col) + 1;
          if (colIdx > 0) r.getCell(colIdx).numFmt = FMT_CURRENCY;
        });

        // Weight format
        const wIdx = orderCols.indexOf('Total Weight (kg)') + 1;
        if (wIdx > 0) r.getCell(wIdx).numFmt = FMT_NUMBER;

        // Tax rate %
        const tIdx = orderCols.indexOf('Tax Rate (%)') + 1;
        if (tIdx > 0) r.getCell(tIdx).numFmt = '0.0"%"';
      });

      freezeAndFilter(wsOrders, 1, orderCols.length);
    } else {
      wsOrders.addRow(['No orders yet']);
    }


    // ══════════════════════════════════════════════════════════════
    // SHEET 2 — CUSTOMERS
    // ══════════════════════════════════════════════════════════════
    const wsCusts = wb.addWorksheet('Customers', {
      properties: { tabColor: { argb: 'FF333333' } },
    });

    if (customers.length > 0) {
      const custCols = Object.keys(customers[0]);

      wsCusts.columns = custCols.map(key => ({
        header: key, key, width: Math.max(key.length + 4, _guessWidth(key)),
      }));

      applyHeaderRow(wsCusts.getRow(1));

      customers.forEach((row, i) => {
        const r = wsCusts.addRow(Object.values(row));
        applyDataRow(r, i);

        const spentIdx = custCols.indexOf('Total Spent (EGP)') + 1;
        if (spentIdx > 0) r.getCell(spentIdx).numFmt = FMT_CURRENCY;

        const wIdx = custCols.indexOf('Total Weight (kg)') + 1;
        if (wIdx > 0) r.getCell(wIdx).numFmt = FMT_NUMBER;
      });

      freezeAndFilter(wsCusts, 1, custCols.length);
    } else {
      wsCusts.addRow(['No customers yet']);
    }


    // ══════════════════════════════════════════════════════════════
    // SHEET 3 — ORDER ITEMS
    // ══════════════════════════════════════════════════════════════
    const wsItems = wb.addWorksheet('Order Items', {
      properties: { tabColor: { argb: 'FF555555' } },
    });

    if (items.length > 0) {
      const itemCols = Object.keys(items[0]);

      wsItems.columns = itemCols.map(key => ({
        header: key, key, width: Math.max(key.length + 4, _guessWidth(key)),
      }));

      applyHeaderRow(wsItems.getRow(1));

      items.forEach((row, i) => {
        const r = wsItems.addRow(Object.values(row));
        applyDataRow(r, i);

        ['Unit Price (EGP)', 'Line Total (EGP)'].forEach(col => {
          const idx = itemCols.indexOf(col) + 1;
          if (idx > 0) r.getCell(idx).numFmt = FMT_CURRENCY;
        });

        const qIdx = itemCols.indexOf('Quantity') + 1;
        if (qIdx > 0) r.getCell(qIdx).numFmt = FMT_NUMBER;
      });

      freezeAndFilter(wsItems, 1, itemCols.length);
    } else {
      wsItems.addRow(['No order items yet']);
    }


    // ══════════════════════════════════════════════════════════════
    // SHEET 4 — SUMMARY
    // ══════════════════════════════════════════════════════════════
    const wsSummary = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: 'FF000000' } },
    });

    // Calculate summary values
    const totalRevenue  = orders.reduce((s, o) => s + (o['Total (EGP)']        || 0), 0);
    const totalWeight   = orders.reduce((s, o) => s + (o['Total Weight (kg)']  || 0), 0);
    const totalOrders   = orders.length;
    const totalCustomers = customers.length;
    const exportDate    = new Date().toLocaleString('en-EG');

    const summaryRows = [
      ['Bahr Coffee Store — Data Export'],
      [''],
      ['Export Date',      exportDate],
      [''],
      ['SUMMARY',          ''],
      ['Total Orders',     totalOrders],
      ['Total Customers',  totalCustomers],
      ['Total Revenue',    totalRevenue],
      ['Total Coffee Sold (kg)', +totalWeight.toFixed(3)],
      [''],
      ['SHEETS IN THIS WORKBOOK', ''],
      ['Orders',       'One row per order transaction'],
      ['Customers',    'One row per customer with lifetime stats'],
      ['Order Items',  'Every product line item across all orders'],
      ['Summary',      'This sheet'],
      [''],
      ['Generated by Bahr Coffee Store POS System'],
    ];

    wsSummary.columns = [{ width: 35 }, { width: 45 }];

    summaryRows.forEach((rowData, i) => {
      const r = wsSummary.addRow(rowData);

      // Title row
      if (i === 0) {
        r.getCell(1).font  = { bold: true, size: 16, name: 'Calibri' };
        r.getCell(1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
        r.getCell(1).font  = { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
        r.height = 28;
      }

      // Section headers
      if (rowData[0] === 'SUMMARY' || rowData[0] === 'SHEETS IN THIS WORKBOOK') {
        r.getCell(1).font = { bold: true, size: 11, name: 'Calibri' };
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      }

      // Revenue row — currency format
      if (rowData[0] === 'Total Revenue') {
        r.getCell(2).numFmt = FMT_CURRENCY;
      }

      // Weight row
      if (rowData[0] === 'Total Coffee Sold (kg)') {
        r.getCell(2).numFmt = FMT_NUMBER;
      }

      r.getCell(1).font = r.getCell(1).font || { name: 'Calibri', size: 10 };
    });


    // ── Stream response ───────────────────────────────────────────
    const filename = `BahrCoffee_Export_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('[Export] Error:', err.message);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});


// ── Private helper: guess a sensible column width from the key name ─
function _guessWidth(key) {
  const widths = {
    'Invoice':           14,
    'Date':              13,
    'Order Date':        13,
    'Customer Name':     22,
    'Customer':          22,
    'Name':              22,
    'Mobile':            16,
    'Address':           30,
    'Payment Method':    16,
    'Notes':             25,
    'Total Weight (kg)': 18,
    'Subtotal (EGP)':    16,
    'Tax Rate (%)':      13,
    'Tax Amount (EGP)':  17,
    'Total (EGP)':       14,
    'Total Spent (EGP)': 18,
    'Line Total (EGP)':  16,
    'Unit Price (EGP)':  16,
    'Product (Arabic)':  22,
    'Product (English)': 22,
    'Quantity':          12,
    'Unit':              10,
    'Created At':        20,
    'Customer Since':    20,
  };
  return widths[key] || 15;
}


module.exports = router;
