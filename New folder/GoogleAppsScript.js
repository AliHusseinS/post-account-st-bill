/**
 * كود Google Apps Script المعتمد لنظام الدراسات العليا والحسابات
 * جدول البيانات:
 * https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60/edit?gid=0
 * معرف الجدول:
 * 1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60
 *
 * تعليمات النشر:
 * 1. افتح Apps Script > انقر "نشر / Deploy" > "نشر جديد / New deployment"
 * 2. اختر النوع: Web app
 * 3. Execute as: Me
 * 4. Who has access: Anyone
 * 5. انقر Deploy وانسخ رابط الـ Web App
 */

var TARGET_SPREADSHEET_ID = "1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60";

var HEADERS = [
  "معرف الطالب",
  "اسم الطالب الرباعي",
  "النفقة",
  "القسم",
  "نوع الدراسة",
  "التخصص",
  "سنة القبول",
  "سنة التخرج",
  "حالة التسديد",
  "المبلغ المدفوع",
  "تاريخ التسديد",
  "المدقق",
  "تاريخ الإضافة",
  "حالة صورة الوصل"
];

// دالة الوصول للجدول المعتمد دائماً عبر ID
function getTargetSheet() {
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID).getActiveSheet();
}

// -------------------------------------------------------
// تصفير الجدول وإعداده فارغاً (شغّلها يدوياً مرة واحدة)
// -------------------------------------------------------
function setupEmptySheet() {
  var sheet = getTargetSheet();
  sheet.clear();
  sheet.setRightToLeft(true);
  sheet.appendRow(HEADERS);

  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setBackground("#0f766e");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  sheet.autoResizeColumns(1, HEADERS.length);

  Logger.log("تم تصفير الجدول وإعداده فارغاً بنجاح!");
}

// -------------------------------------------------------
// حذف صفوف الاختبار (شغّلها لمسح STU-TEST-BIG والمشابهة)
// -------------------------------------------------------
function cleanTestRows() {
  var sheet = getTargetSheet();
  var data = sheet.getDataRange().getValues();
  // نحذف من الأسفل للأعلى لتفادي إزاحة الصفوف
  for (var i = data.length - 1; i >= 1; i--) {
    var id = String(data[i][0] || '').trim();
    if (id.startsWith('TEST') || id.startsWith('STU-TEST') || id === '') {
      sheet.deleteRow(i + 1);
      Logger.log("تم حذف الصف: " + id);
    }
  }
  Logger.log("تم تنظيف صفوف الاختبار بنجاح!");
}

// -------------------------------------------------------
// استقبال طالب جديد أو تحديث بيانات التسديد (POST)
// -------------------------------------------------------
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);

  try {
    var sheet = getTargetSheet();
    var data = JSON.parse(e.postData.contents);

    // إنشاء صف العناوين تلقائياً إذا كان الجدول فارغاً
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setBackground("#0f766e");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      sheet.setRightToLeft(true);
    }

    var studentId = String(data.id || '').trim();

    // البحث عن الطالب لتحديث سجله أو إضافته كطالب جديد
    var rows = sheet.getDataRange().getValues();
    var rowIndexToUpdate = -1;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === studentId) {
        rowIndexToUpdate = i + 1; // 1-based
        break;
      }
    }

    // بناء قيم الصف الكاملة (14 عمود)
    var rowValues = [
      studentId,
      data.fullName      || "",
      data.expenseType   || "",
      data.department    || "",
      data.studyType     || "",
      data.specialization || "",
      data.admissionYear || "",
      data.graduationYear || "",
      data.isPaid ? "تم التسديد" : "لم يتم التسديد",
      data.paymentAmount ? (String(data.paymentAmount).replace(/[^\d.]/g, '') + " د.ع") : "-",
      data.paymentDate   || "-",
      data.auditorName   || "-",
      data.createdAt     || new Date().toLocaleString("ar-IQ"),
      data.receiptImage  ? "تم رفع الوصل" : "غير مرفق"
    ];

    if (rowIndexToUpdate > 0) {
      sheet.getRange(rowIndexToUpdate, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    sheet.autoResizeColumns(1, HEADERS.length);

    return ContentService
      .createTextOutput(JSON.stringify({ result: "success", id: studentId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------
// قراءة جميع بيانات الطلبة وإعادتها بصيغة JSON (GET)
// -------------------------------------------------------
function doGet(e) {
  try {
    var sheet = getTargetSheet();
    var data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return ContentService
        .createTextOutput(JSON.stringify([]))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var result = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var id = String(row[0] || '').trim();
      // تجاهل صفوف الاختبار والصفوف الفارغة
      if (!id || id.startsWith('TEST') || id.startsWith('STU-TEST')) continue;

      result.push({
        id:             id,
        fullName:       String(row[1]  || ''),
        expenseType:    String(row[2]  || ''),
        department:     String(row[3]  || ''),
        studyType:      String(row[4]  || ''),
        specialization: String(row[5]  || ''),
        admissionYear:  String(row[6]  || ''),
        graduationYear: String(row[7]  || ''),
        status:         String(row[8]  || ''),
        paymentAmount:  String(row[9]  || ''),
        paymentDate:    String(row[10] || ''),
        auditorName:    String(row[11] || ''),
        createdAt:      String(row[12] || ''),
        receiptStatus:  String(row[13] || '')
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
