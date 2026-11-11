// ============================================================
// Google Apps Script — Postgrad Tuition System
// كلية التخطيط العمراني / الدراسات العليا / المتابعة
//
// Paste this entire file into the Apps Script editor, then:
//   1. Run  manualSetup()  once to migrate data & add header.
//   2. Deploy → New Deployment → Web App (Execute as: Me, Access: Anyone)
//   3. Copy the new URL into app.js → SCRIPT_URL
// ============================================================

// ----------------------------------------------------------------
// Column indices (0-based)
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
  RECEIPT_IMAGE:17   // R - صورة الوصل (=IMAGE)
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
// Helpers
// ----------------------------------------------------------------
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function hasHeaderRow(sheet) {
  if (sheet.getLastRow() === 0) return false;
  // Check if Col 9 is 'المبلغ المقرر الأصلي' and Col 18 is 'صورة الوصل'
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

// Helper: Save receipt image to Google Drive if authorized
function saveReceiptImageToDrive(base64Data, fileName) {
  if (!base64Data || typeof base64Data !== 'string') return null;
  try {
    var folderName = 'وصلات رسوم الدراسات العليا';
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    var contentType = 'image/jpeg';
    if (base64Data.indexOf('data:image/png') === 0) contentType = 'image/png';
    else if (base64Data.indexOf('data:image/webp') === 0) contentType = 'image/webp';

    var cleanBase64 = base64Data.indexOf(',') > -1 ? base64Data.split(',')[1] : base64Data;
    var bytes = Utilities.base64Decode(cleanBase64);
    var blob = Utilities.newBlob(bytes, contentType, fileName);
    var file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    var fileId = file.getId();
    return {
      fileId: fileId,
      viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
      directUrl: 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000'
    };
  } catch (err) {
    Logger.log('DriveApp save warning: ' + err.message);
    return null;
  }
}

function studentToRow(student) {
  var studentName = student.fullName || 'طالب';

  var paymentsClean = (student.payments || []).map(function(p, idx) {
    var receiptUrl = p.receiptUrl || '';
    var receiptViewUrl = p.receiptViewUrl || '';

    // If receiptImage (base64) is provided and not yet uploaded to Drive, try saving
    if (p.receiptImage && !receiptUrl) {
      var fileName = 'وصل_' + studentName.replace(/\s+/g, '_') + '_' + (p.date || 'pay') + '_' + (idx + 1) + '.jpg';
      var driveRes = saveReceiptImageToDrive(p.receiptImage, fileName);
      if (driveRes) {
        receiptUrl = driveRes.directUrl;
        receiptViewUrl = driveRes.viewUrl;
      }
    }

    return {
      id:             p.id,
      amount:         safeNum(p.amount),
      date:           p.date || '',
      auditor:        p.auditor || '',
      receiptUrl:     receiptUrl,
      receiptViewUrl: receiptViewUrl
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

  // Find latest receipt URL
  var latestReceiptUrl = '';
  var latestViewUrl = '';
  for (var k = paymentsClean.length - 1; k >= 0; k--) {
    if (paymentsClean[k].receiptUrl) {
      latestReceiptUrl = paymentsClean[k].receiptUrl;
      latestViewUrl = paymentsClean[k].receiptViewUrl || latestReceiptUrl;
      break;
    }
  }

  var receiptImageFormula = '-';
  if (latestReceiptUrl) {
    // In-cell image formula with link
    receiptImageFormula = '=HYPERLINK("' + latestViewUrl + '", IMAGE("' + latestReceiptUrl + '", 1))';
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
  row[COL.RECEIPT_IMAGE] = receiptImageFormula;
  return row;
}

// ----------------------------------------------------------------
// Migration: old 14-col format → new 17-col format
// ----------------------------------------------------------------
function migrateOldData(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    // Empty sheet, just add header
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }

  var firstCell = String(sheet.getRange(1, 1).getValue() || '').trim();
  var isOldHeader = (firstCell === 'معرف الطالب');

  if (!isOldHeader) {
    // Row 1 is data without header, insert header row at top
    sheet.insertRowBefore(1);
  }

  // Set the 17-column header in row 1
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  var newLastRow = sheet.getLastRow();
  if (newLastRow <= 1) return;

  var numCols = Math.max(sheet.getLastColumn(), 17);
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

    // Default totalFee
    var totalFee = (oldExpenseType === 'نفقة خاصة') ? DEFAULT_EXPENSE_FEE : 0;
    var payments = [];
    var createdAt = (old.length > 14 && old[14] && String(old[14]).length > 5)
      ? String(old[14])
      : (old.length > 12 && old[12] && String(old[12]).length > 5 ? String(old[12]) : new Date().toISOString());

    // Check if payments JSON already exists in col 16
    if (old.length > 16 && old[16]) {
      try { payments = JSON.parse(String(old[16])); } catch (e) { payments = []; }
    }

    // Fallback: parse old single payment from col 9
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

  // Format numeric columns I, J, K
  try {
    sheet.getRange(2, 9, sheet.getLastRow() - 1, 3).setNumberFormat('#,##0');
  } catch (e) {}
}

// ----------------------------------------------------------------
// manualAuthorizeDrive — run once in Apps Script editor to authorize Drive access
// ----------------------------------------------------------------
function manualAuthorizeDrive() {
  var root = DriveApp.getRootFolder();
  Logger.log('Drive authorized successfully! Root folder: ' + root.getName());
}

// ----------------------------------------------------------------
// manualSetup — run once from Apps Script editor
// ----------------------------------------------------------------
function manualSetup() {
  var sheet = getSheet();
  if (!hasHeaderRow(sheet)) {
    Logger.log('No header found. Running migration...');
    migrateOldData(sheet);
    Logger.log('Migration complete.');
  } else {
    Logger.log('Header already present. No migration needed.');
  }
  try {
    var lastDataRow = sheet.getLastRow();
    if (lastDataRow > 1) {
      sheet.getRange(2, 9, lastDataRow - 1, 3).setNumberFormat('#,##0');
    }
  } catch(e) {
    Logger.log('Format warning: ' + e);
  }
  Logger.log('manualSetup done successfully.');
}

// ----------------------------------------------------------------
// ensureHeader — called at runtime before every read/write
// ----------------------------------------------------------------
function ensureHeader(sheet) {
  if (!hasHeaderRow(sheet)) {
    migrateOldData(sheet);
  }
}

// ----------------------------------------------------------------
// CORS output helper
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

  var sheet = getSheet();
  ensureHeader(sheet);

  // DELETE via GET
  if (action === 'delete') {
    var deleteId = String(params.id || '').trim();
    if (!deleteId) {
      return corsOutput({ success: false, error: 'Missing id parameter' });
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return corsOutput({ success: false, error: 'No data rows' });
    }
    var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var deleted = false;
    for (var i = idValues.length - 1; i >= 0; i--) {
      if (String(idValues[i][0]).trim() === deleteId) {
        sheet.deleteRow(i + 2);
        deleted = true;
        break;
      }
    }
    return corsOutput({
      success: deleted,
      message: deleted ? ('Deleted: ' + deleteId) : ('Not found: ' + deleteId)
    });
  }

  // DEFAULT: return all students as JSON array
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return corsOutput([]);
  }
  var numCols = Math.max(sheet.getLastColumn(), HEADERS.length);
  var rows = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  var students = rows
    .map(rowToStudent)
    .filter(function(s) { return s.id && s.id.trim() !== ''; });
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

  // DELETE via POST
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
        break;
      }
    }
    return corsOutput({ success: deleted, message: deleted ? 'Deleted' : 'Not found' });
  }

  // SAVE / UPDATE
  var student = body.student || body;

  // Default fee for نفقة خاصة
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

  var newRow    = studentToRow(student);
  var studentId = String(newRow[COL.ID]).trim();

  // Check if student already exists → update, else append
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
