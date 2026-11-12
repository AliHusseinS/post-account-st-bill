// ============================================================
// Google Apps Script — Postgrad Tuition System
// كلية التخطيط العمراني / الدراسات العليا / المتابعة
// ============================================================

var SCRIPT_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwCAmMVLdSUBe4cIu3nFOI7-DpsK9j_33RZ8edHilBnqyYiknlo7k7fWIc46AA5ASOd/exec';

// ----------------------------------------------------------------
// Column indices (0-based) for Sheet1
// ----------------------------------------------------------------
var COL = {
  ID:            0,  // A - معرف الطالب
  FULL_NAME:     1,  // B - اسم الطالب الرباعي
  EXPENSE_TYPE:  2,  // C - النفقة
  DEPARTMENT:    3,  // D - القسم
  STUDY_TYPE:    4,  // E - نوع الدراسة
  SPECIALIZATION:5,  // F - التخصص
  ADMISSION_YEAR:6,  // G - سنة القبول
  GRAD_YEAR:     7,  // H - سنة التخرج
  TOTAL_FEE:     8,  // I - المبلغ المقرر الأصلي  (NUMBER)
  PAID_AMOUNT:   9,  // J - إجمالي المسدد         (NUMBER)
  REMAINING:    10,  // K - المبلغ المتبقي         (NUMBER)
  STATUS:       11,  // L - حالة التسديد
  LAST_PAY_DATE:12,  // M - تاريخ آخر تسديد
  LAST_AUDITOR: 13,  // N - آخر مدقق
  CREATED_AT:   14,  // O - تاريخ الإضافة
  RECEIPT_COUNT:15,  // P - عدد الوصولات
  PAYMENTS_JSON:16,  // Q - سجل الدفعات (JSON)
  RECEIPT_IMAGE:17   // R - صورة الوصل (=HYPERLINK / =IMAGE)
};

var HEADERS = [
  'معرف الطالب',
  'اسم الطالب الرباعي',
  'النفقة',
  'القسم',
  'نوع الدراسة',
  'التخصص',
  'سنة القبول',
  'سنة التخرج',
  'المبلغ المقرر الأصلي',
  'إجمالي المسدد',
  'المبلغ المتبقي',
  'حالة التسديد',
  'تاريخ آخر تسديد',
  'آخر مدقق',
  'تاريخ الإضافة',
  'عدد الوصولات',
  'سجل الدفعات',
  'صورة الوصل'
];

var SHEET_NAME = 'Sheet1';
var DEFAULT_EXPENSE_FEE = 3750000;

// ----------------------------------------------------------------
// Helpers — Sheet & Numbers
// ----------------------------------------------------------------
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function getReceiptsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Receipts');
  if (!sheet) {
    sheet = ss.insertSheet('Receipts');
    sheet.getRange(1, 1, 1, 6).setValues([['معرف الدفعة', 'معرف الطالب', 'اسم الطالب', 'تاريخ الوصل', 'صورة الوصل (Base64)', 'تاريخ التخزين']]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0d9488').setFontColor('#ffffff');
  }
  return sheet;
}

function hasHeaderRow(sheet) {
  if (sheet.getLastRow() === 0) return false;
  var col9  = String(sheet.getRange(1, 9).getValue() || '').trim();
  var col18 = String(sheet.getRange(1, 18).getValue() || '').trim();
  return col9 === 'المبلغ المقرر الأصلي' && col18 === 'صورة الوصل';
}

function generateId() {
  return 'STU-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

function safeNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/د\.ع|,|\s/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function computeStatus(totalFee, paidAmount) {
  if (totalFee === 0) return 'معفى / نفقة عامة';
  if (paidAmount === 0) return 'لم يتم التسديد';
  if (paidAmount >= totalFee) return 'تم التسديد بالكامل';
  var pct = Math.round((paidAmount / totalFee) * 100);
  return 'مسدد جزئياً (' + pct + '%)';
}

// ----------------------------------------------------------------
// Receipts Storage in Google Sheets (Persistent across all devices)
// ----------------------------------------------------------------
function saveReceiptImage(payId, stuId, stuName, date, base64) {
  if (!payId || !base64) return;
  try {
    var sheet = getReceiptsSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(payId).trim()) {
          sheet.getRange(i + 2, 5).setValue(base64);
          sheet.getRange(i + 2, 6).setValue(new Date().toISOString());
          return;
        }
      }
    }
    sheet.appendRow([payId, stuId, stuName, date, base64, new Date().toISOString()]);
  } catch (e) {
    Logger.log('saveReceiptImage error: ' + e);
  }
}

function deleteReceiptImage(payId) {
  if (!payId) return;
  try {
    var sheet = getReceiptsSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]).trim() === String(payId).trim()) {
        sheet.deleteRow(i + 2);
        break;
      }
    }
  } catch (e) {}
}

function deleteStudentReceipts(studentId) {
  if (!studentId) return;
  try {
    var sheet = getReceiptsSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    var data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]).trim() === String(studentId).trim()) {
        sheet.deleteRow(i + 2);
      }
    }
  } catch (e) {}
}

function getAllReceiptsMap() {
  var map = {};
  try {
    var sheet = getReceiptsSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return map;
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < data.length; i++) {
      var pId = String(data[i][0]).trim();
      var b64 = String(data[i][4] || '').trim();
      if (pId && b64) {
        map[pId] = b64;
      }
    }
  } catch (e) {
    Logger.log('getAllReceiptsMap error: ' + e);
  }
  return map;
}

function getReceiptDetails(payId) {
  var res = { b64: '', stuName: '', date: '' };
  if (!payId) return res;
  try {
    var sheet = getReceiptsSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return res;
    var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(payId).trim()) {
        res.b64 = String(data[i][4] || '').trim();
        res.stuName = String(data[i][2] || '').trim();
        res.date = String(data[i][3] || '').trim();
        break;
      }
    }
  } catch (e) {
    Logger.log('getReceiptDetails error: ' + e);
  }
  return res;
}

// ----------------------------------------------------------------
// Row <-> Student Conversion
// ----------------------------------------------------------------
function rowToStudent(row) {
  var paymentsRaw = row[COL.PAYMENTS_JSON];
  var payments = [];
  try {
    if (paymentsRaw && String(paymentsRaw).trim() !== '') {
      payments = JSON.parse(String(paymentsRaw));
    }
  } catch (e) {
    payments = [];
  }
  return {
    id:             String(row[COL.ID] || ''),
    fullName:       String(row[COL.FULL_NAME] || ''),
    expenseType:    String(row[COL.EXPENSE_TYPE] || ''),
    department:     String(row[COL.DEPARTMENT] || ''),
    studyType:      String(row[COL.STUDY_TYPE] || ''),
    specialization: String(row[COL.SPECIALIZATION] || ''),
    admissionYear:  String(row[COL.ADMISSION_YEAR] || ''),
    graduationYear: String(row[COL.GRAD_YEAR] || ''),
    totalFee:       safeNum(row[COL.TOTAL_FEE]),
    paidAmount:     safeNum(row[COL.PAID_AMOUNT]),
    remainingAmount:safeNum(row[COL.REMAINING]),
    status:         String(row[COL.STATUS] || ''),
    lastPayDate:    String(row[COL.LAST_PAY_DATE] || ''),
    lastAuditor:    String(row[COL.LAST_AUDITOR] || ''),
    createdAt:      String(row[COL.CREATED_AT] || ''),
    receiptCount:   String(row[COL.RECEIPT_COUNT] || '0 وصولات'),
    payments:       payments
  };
}

function studentToRow(student) {
  var studentName = student.fullName || 'طالب';

  var paymentsClean = (student.payments || []).map(function(p) {
    var receiptUrl = p.receiptUrl || '';
    if (p.hasReceipt || p.receiptImage) {
      receiptUrl = SCRIPT_WEBAPP_URL + '?action=view_receipt&id=' + encodeURIComponent(p.id);
    }
    return {
      id:             p.id,
      amount:         safeNum(p.amount),
      date:           p.date || '',
      auditor:        p.auditor || '',
      hasReceipt:     Boolean(p.receiptImage || p.hasReceipt || p.receiptUrl),
      receiptUrl:     receiptUrl
    };
  });

  var totalFee   = safeNum(student.totalFee);
  var paidAmount = 0;
  paymentsClean.forEach(function(p) { paidAmount += safeNum(p.amount); });
  var remaining  = Math.max(0, totalFee - paidAmount);
  var status     = computeStatus(totalFee, paidAmount);

  var lastPayDate = '';
  var lastAuditor = '';
  if (paymentsClean.length > 0) {
    var last = paymentsClean[paymentsClean.length - 1];
    lastPayDate = last.date || '';
    lastAuditor = last.auditor || '';
  }

  // Find latest payment with a receipt
  var latestReceiptPayId = '';
  for (var k = paymentsClean.length - 1; k >= 0; k--) {
    if (paymentsClean[k].hasReceipt) {
      latestReceiptPayId = paymentsClean[k].id;
      break;
    }
  }

  var receiptCellFormula = '-';
  if (latestReceiptPayId) {
    var viewUrl = SCRIPT_WEBAPP_URL + '?action=view_receipt&id=' + encodeURIComponent(latestReceiptPayId);
    receiptCellFormula = '=HYPERLINK("' + viewUrl + '", "🖼️ عرض الوصل")';
  }

  var row = new Array(18).fill('');
  row[COL.ID]            = student.id || generateId();
  row[COL.FULL_NAME]     = student.fullName || '';
  row[COL.EXPENSE_TYPE]  = student.expenseType || '';
  row[COL.DEPARTMENT]    = student.department || '';
  row[COL.STUDY_TYPE]    = student.studyType || '';
  row[COL.SPECIALIZATION]= student.specialization || '';
  row[COL.ADMISSION_YEAR]= student.admissionYear || '';
  row[COL.GRAD_YEAR]     = student.graduationYear || '';
  row[COL.TOTAL_FEE]     = totalFee;
  row[COL.PAID_AMOUNT]   = paidAmount;
  row[COL.REMAINING]     = remaining;
  row[COL.STATUS]        = status;
  row[COL.LAST_PAY_DATE] = lastPayDate;
  row[COL.LAST_AUDITOR]  = lastAuditor;
  row[COL.CREATED_AT]    = student.createdAt || new Date().toISOString();
  row[COL.RECEIPT_COUNT] = paymentsClean.length + ' وصولات';
  row[COL.PAYMENTS_JSON] = JSON.stringify(paymentsClean);
  row[COL.RECEIPT_IMAGE] = receiptCellFormula;
  return row;
}

// ----------------------------------------------------------------
// Migration
// ----------------------------------------------------------------
function migrateOldData(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }

  var firstCell = String(sheet.getRange(1, 1).getValue() || '').trim();
  var isOldHeader = (firstCell === 'معرف الطالب');

  if (!isOldHeader) {
    sheet.insertRowBefore(1);
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  var newLastRow = sheet.getLastRow();
  if (newLastRow <= 1) return;

  var numCols = Math.max(sheet.getLastColumn(), HEADERS.length);
  var data = sheet.getRange(2, 1, newLastRow - 1, numCols).getValues();

  for (var i = 0; i < data.length; i++) {
    var old = data[i];
    var sheetRow = i + 2;

    var oldId          = String(old[0] || generateId()).trim();
    var oldFullName    = String(old[1] || '').trim();
    var oldExpenseType = String(old[2] || 'نفقة خاصة').trim();
    var oldDept        = String(old[3] || '').trim();
    var oldStudyType   = String(old[4] || 'ماجستير').trim();
    var oldSpec        = String(old[5] || '').trim();
    var oldAdmYear     = String(old[6] || '').trim();
    var oldGradYear    = String(old[7] || '').trim();

    var totalFee = (oldExpenseType === 'نفقة خاصة') ? DEFAULT_EXPENSE_FEE : 0;
    var payments = [];
    var createdAt = (old.length > 14 && old[14] && String(old[14]).length > 5)
      ? String(old[14])
      : (old.length > 12 && old[12] && String(old[12]).length > 5 ? String(old[12]) : new Date().toISOString());

    if (old.length > 16 && old[16]) {
      try { payments = JSON.parse(String(old[16])); } catch (e) { payments = []; }
    }

    if (payments.length === 0) {
      var oldPaid = safeNum(old[9]);
      if (oldPaid > 0) {
        payments.push({
          id:      'migrated-' + Date.now() + '-' + i,
          amount:  oldPaid,
          date:    (old[10] && old[10] !== '-') ? String(old[10]) : '',
          auditor: (old[11] && old[11] !== '-') ? String(old[11]) : 'مهاجر (بيانات سابقة)'
        });
      }
    }

    var student = {
      id:             oldId,
      fullName:       oldFullName,
      expenseType:    oldExpenseType,
      department:     oldDept,
      studyType:      oldStudyType,
      specialization: oldSpec,
      admissionYear:  oldAdmYear,
      graduationYear: oldGradYear,
      totalFee:       totalFee,
      payments:       payments,
      createdAt:      createdAt
    };

    var newRow = studentToRow(student);
    sheet.getRange(sheetRow, 1, 1, newRow.length).setValues([newRow]);
  }

  try {
    sheet.getRange(2, 9, sheet.getLastRow() - 1, 3).setNumberFormat('#,##0');
  } catch (e) {}
}

function ensureHeader(sheet) {
  if (!hasHeaderRow(sheet)) {
    migrateOldData(sheet);
  }
}

// ----------------------------------------------------------------
// CORS Output Helper
// ----------------------------------------------------------------
function corsOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------
// doGet
// ----------------------------------------------------------------
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || '';

  // 1. VIEW RECEIPT — Opens receipt in browser directly (e.g. from Google Sheet)
  if (action === 'view_receipt') {
    var viewPayId = String(params.id || '').trim();
    var rec = getReceiptDetails(viewPayId);
    var b64 = rec.b64;

    if (!b64) {
      var notFoundHtml = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>الوصل غير موجود</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}.box{text-align:center;padding:40px;background:#1e293b;border-radius:16px;border:1px solid #334155;}h2{color:#f87171;margin-bottom:8px;}p{color:#94a3b8;}</style></head><body><div class="box"><h2>⚠️ لم يتم العثور على صورة الوصل</h2><p>قد تكون الدفعة سُجلت بدون إرفاق صورة للوصل.</p></div></body></html>';
      return HtmlService.createHtmlOutput(notFoundHtml);
    }

    var metaInfo = '';
    if (rec.stuName || rec.date) {
      metaInfo = '<div style="color:#94a3b8;font-size:14px;margin-bottom:16px;padding:8px 16px;background:#0f172a;border-radius:8px;display:inline-block;">' +
        (rec.stuName ? ('الطالب: <strong style="color:#5eead4;">' + rec.stuName + '</strong>') : '') +
        (rec.stuName && rec.date ? ' &nbsp;|&nbsp; ' : '') +
        (rec.date ? ('التاريخ: <strong style="color:#fff;">' + rec.date + '</strong>') : '') +
        '</div><br>';
    }

    var html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>وصل تسديد — كلية التخطيط العمراني</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:20px;background:#0f172a;color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;box-sizing:border-box;}.card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;text-align:center;max-width:96vw;}h2{color:#5eead4;margin:0 0 12px 0;font-size:20px;}img{max-width:100%;max-height:80vh;border-radius:12px;border:1px solid #475569;box-shadow:0 12px 35px rgba(0,0,0,0.5);}.btn{margin-top:18px;padding:10px 28px;background:#0d9488;color:#fff;font-weight:bold;border-radius:10px;border:none;cursor:pointer;font-size:15px;}</style></head><body><div class="card"><h2>وصل تسديد رسمي — كلية التخطيط العمراني</h2>' + metaInfo + '<img src="' + b64 + '"><br><button class="btn" onclick="window.print()">🖨️ طباعة الوصل</button></div></body></html>';
    return HtmlService.createHtmlOutput(html);
  }

  // 2. GET RECEIPT JSON — For client-side fetch
  if (action === 'get_receipt') {
    var getPayId = String(params.id || '').trim();
    var recJson = getReceiptDetails(getPayId);
    return corsOutput({ success: Boolean(recJson.b64), receiptImage: recJson.b64, studentName: recJson.stuName, date: recJson.date });
  }

  // DEBUG — Inspect sheets structure
  if (action === 'debug') {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheets = ss.getSheets().map(function(s) {
        var lr = s.getLastRow();
        var lc = s.getLastColumn();
        return {
          name: s.getName(),
          lastRow: lr,
          lastColumn: lc,
          headers: lr > 0 ? s.getRange(1, 1, 1, Math.min(lc, 18)).getValues()[0] : []
        };
      });
      return corsOutput({ success: true, sheets: sheets });
    } catch (e) {
      return corsOutput({ success: false, error: e.toString() });
    }
  }

  var sheet = getSheet();
  ensureHeader(sheet);

  // 2. DELETE via GET
  if (action === 'delete') {
    var deleteId = String(params.id || '').trim();
    if (!deleteId) return corsOutput({ success: false, error: 'Missing id parameter' });
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return corsOutput({ success: false, error: 'No data rows' });
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var deleted = false;
    for (var i = idValues.length - 1; i >= 0; i--) {
      if (String(idValues[i][0]).trim() === deleteId) {
        sheet.deleteRow(i + 2);
        deleted = true;
        deleteStudentReceipts(deleteId);
        break;
      }
    }
    return corsOutput({ success: deleted, message: deleted ? ('Deleted: ' + deleteId) : ('Not found: ' + deleteId) });
  }

  // 3. DEFAULT: return all students with receipt images merged
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return corsOutput([]);

  var numCols = Math.max(sheet.getLastColumn(), HEADERS.length);
  var rows = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  var receiptsMap = getAllReceiptsMap();

  var students = rows
    .map(rowToStudent)
    .filter(function(s) { return s.id && s.id.trim() !== ''; })
    .map(function(s) {
      s.payments = (s.payments || []).map(function(p) {
        if (receiptsMap[p.id]) {
          p.receiptImage = receiptsMap[p.id];
          p.hasReceipt = true;
        }
        return p;
      });
      return s;
    });

  return corsOutput(students);
}

// ----------------------------------------------------------------
// doPost
// ----------------------------------------------------------------
function doPost(e) {
  var sheet = getSheet();
  ensureHeader(sheet);

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return corsOutput({ success: false, error: 'Invalid JSON: ' + err.message });
  }

  var action = body.action || 'save';

  // DELETE
  if (action === 'delete') {
    var deleteId = String(body.id || '').trim();
    if (!deleteId) return corsOutput({ success: false, error: 'Missing id' });
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return corsOutput({ success: false, error: 'No data rows' });
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var deleted = false;
    for (var i = idValues.length - 1; i >= 0; i--) {
      if (String(idValues[i][0]).trim() === deleteId) {
        sheet.deleteRow(i + 2);
        deleted = true;
        deleteStudentReceipts(deleteId);
        break;
      }
    }
    return corsOutput({ success: deleted, message: deleted ? 'Deleted' : 'Not found' });
  }

  // SAVE / UPDATE
  var student = body.student || body;

  var totalFee = safeNum(student.totalFee);
  if (totalFee === 0 && student.expenseType === 'نفقة خاصة') {
    totalFee = DEFAULT_EXPENSE_FEE;
  }
  student.totalFee = totalFee;

  if (!student.id || String(student.id).trim() === '') {
    student.id = generateId();
  }
  if (!student.createdAt) {
    student.createdAt = new Date().toISOString();
  }

  // Save any receipt images to Receipts sheet tab
  (student.payments || []).forEach(function(p) {
    if (p.receiptImage && String(p.receiptImage).indexOf('data:image') === 0) {
      saveReceiptImage(p.id, student.id, student.fullName, p.date, p.receiptImage);
    }
  });

  var newRow    = studentToRow(student);
  var studentId = String(newRow[COL.ID]).trim();

  var lastRow        = sheet.getLastRow();
  var existingRowIdx = -1;
  if (lastRow > 1) {
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var j = 0; j < idValues.length; j++) {
      if (String(idValues[j][0]).trim() === studentId) {
        existingRowIdx = j + 2;
        break;
      }
    }
  }

  if (existingRowIdx > 0) {
    sheet.getRange(existingRowIdx, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }

  return corsOutput({ success: true, id: studentId });
}
