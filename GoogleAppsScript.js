/**
 * =====================================================================
 * كود Google Apps Script المعتمد لنظام الدراسات العليا والحسابات
 * يدعم تلقائياً الأعمدة الـ 17 الموسعة، حركات الدفع والأقساط المتعددة،
 * والمزامنة اللحظية مع ترحيل البيانات القديمة تلقائياً دون فقدان أي بيانات
 * ---------------------------------------------------------------------
 * كلية التخطيط العمراني / الدراسات العليا / المتابعة
 * جدول البيانات:
 * https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60/edit?gid=0
 * 
 * معرف الجدول:
 * 1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60
 * =====================================================================
 */

var TARGET_SPREADSHEET_ID = "1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60";

// العناوين الـ 17 المعتمدة لجدول البيانات
var HEADERS = [
  "معرف الطالب",
  "اسم الطالب الرباعي",
  "النفقة",
  "القسم",
  "نوع الدراسة",
  "التخصص",
  "سنة القبول",
  "سنة التخرج",
  "المبلغ المقرر الأصلي",
  "إجمالي المسدد",
  "المبلغ المتبقي",
  "حالة التسديد",
  "تاريخ آخر تسديد",
  "المدقق",
  "تاريخ الإضافة",
  "عدد الوصولات",
  "سجل الدفعات التفصيلي"
];

function getTargetSheet() {
  try {
    if (SpreadsheetApp.getActiveSpreadsheet()) {
      return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    }
  } catch (e) {}
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID).getActiveSheet();
}

/**
 * دالة الترحيل والتهيئة التلقائية للأعمدة الـ 17
 * تفحص تلقائياً رأس الجدول وترقي البيانات القديمة إن وُجدت
 */
function migrateAndEnsure17Columns(sheet) {
  var lastRow = sheet.getLastRow();
  sheet.setRightToLeft(true);

  if (lastRow === 0) {
    sheet.appendRow(HEADERS);
    var hRange = sheet.getRange(1, 1, 1, HEADERS.length);
    hRange.setBackground("#0f766e");
    hRange.setFontColor("#ffffff");
    hRange.setFontWeight("bold");
    hRange.setHorizontalAlignment("center");
    return;
  }

  // فحص عنوان العمود التاسع للتأكد من وجود الأعمدة الموسعة
  var col9Header = String(sheet.getRange(1, 9).getValue() || '').trim();
  if (col9Header !== HEADERS[8]) {
    // ترحيل العناوين
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);
    headerRange.setBackground("#0f766e");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");

    // ترحيل الصفوف السابقة إن وجدت
    if (lastRow > 1) {
      var numRows = lastRow - 1;
      var numCols = Math.max(sheet.getLastColumn(), 17);
      var data = sheet.getRange(2, 1, numRows, numCols).getValues();

      for (var r = 0; r < data.length; r++) {
        var row = data[r];
        var id = String(row[0] || '').trim();
        if (!id) continue;

        var expense = String(row[2] || '').trim();
        var val8 = String(row[8] || '').trim();
        var val9 = String(row[9] || '').trim();
        var isOld14Format = val8.includes('تسديد') || val8.includes('التسديد');

        if (isOld14Format) {
          var paidNum = Number(val9.replace(/[^\d.]/g, '')) || 0;
          var totalFeeNum = (expense === 'نفقة خاصة') ? 3750000 : paidNum;
          var remainingNum = Math.max(0, totalFeeNum - paidNum);
          var status = val8;
          var payDate = String(row[10] || '-');
          var auditor = String(row[11] || '-');
          var createdAt = String(row[12] || '');

          var migratedRow = [
            id,
            String(row[1] || ''),
            expense,
            String(row[3] || ''),
            String(row[4] || ''),
            String(row[5] || ''),
            String(row[6] || ''),
            String(row[7] || ''),
            totalFeeNum ? (totalFeeNum.toLocaleString() + " د.ع") : "0 د.ع",
            paidNum ? (paidNum.toLocaleString() + " د.ع") : "0 د.ع",
            remainingNum ? (remainingNum.toLocaleString() + " د.ع") : "0 د.ع",
            status || (paidNum >= totalFeeNum && totalFeeNum > 0 ? "تم التسديد بالكامل" : (paidNum > 0 ? "مسدد جزئياً" : "لم يتم التسديد")),
            payDate,
            auditor,
            createdAt,
            (paidNum > 0 ? "1 وصولات" : "0 وصولات"),
            "[]"
          ];
          sheet.getRange(r + 2, 1, 1, migratedRow.length).setValues([migratedRow]);
        }
      }
    }
  }
}

/**
 * دالة تشغيل يدوية: يمكنك الضغط على تشغيل (Run) لتحديث العناوين وحذف صفوف الاختبار فوراً
 */
function manualSetup() {
  var sheet = getTargetSheet();
  migrateAndEnsure17Columns(sheet);
  cleanTestRows();
  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log("تمت التهيئة والترحيل اليدوي بنجاح!");
}

/**
 * دالة مساعدة لتنظيف أي صفوف اختبار
 */
function cleanTestRows() {
  var sheet = getTargetSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    var id = String(rows[i][0] || '').trim();
    var name = String(rows[i][1] || '').trim();
    if (id.startsWith('TEST') || id.startsWith('STU-TEST') || id.startsWith('NON_EXISTENT') || id === '' || name === '') {
      sheet.deleteRow(i + 1);
      Logger.log("تم حذف الصف التجريبي: " + id);
    }
  }
}

/**
 * حذف طالب بالمعرف
 */
function deleteStudentById(studentId) {
  if (!studentId) return false;
  var sheet = getTargetSheet();
  var rows = sheet.getDataRange().getValues();
  var targetId = String(studentId).trim();
  
  for (var i = rows.length - 1; i >= 1; i--) {
    var currentId = String(rows[i][0] || '').trim();
    if (currentId === targetId) {
      sheet.deleteRow(i + 1);
      Logger.log("تم حذف الطالب: " + targetId);
      return true;
    }
  }
  return false;
}

/**
 * دالة استقبال الطلبات عبر POST (إضافة طالب، تحديث قسط، أو حذف)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(20000);

  try {
    var sheet = getTargetSheet();
    migrateAndEnsure17Columns(sheet);

    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    // --- حالة الحذف ---
    if (data.action === 'delete') {
      var deleted = deleteStudentById(data.id);
      return ContentService.createTextOutput(JSON.stringify({
        result: deleted ? "success" : "not_found",
        action: "delete",
        id: data.id
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var studentId = String(data.id || '').trim();
    if (!studentId) {
      return ContentService.createTextOutput(JSON.stringify({
        result: "error",
        error: "معرف الطالب مفقود"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // فحص الصف للتعرف على الطالب الحالي
    var rows = sheet.getDataRange().getValues();
    var rowIndexToUpdate = -1;

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === studentId) {
        rowIndexToUpdate = i + 1; // 1-based index
        break;
      }
    }

    // تجهيز قيم المبالغ والحالة بدقة
    var expenseType = String(data.expenseType || '').trim();
    var totalFeeNum = Number(String(data.totalFee || 0).replace(/[^\d.]/g, '')) || 0;
    if (totalFeeNum === 0 && expenseType === 'نفقة خاصة') {
      totalFeeNum = 3750000;
    }

    var paidAmountNum = Number(String(data.paidAmount || 0).replace(/[^\d.]/g, '')) || 0;
    var paymentsCount = 0;
    var paymentsJsonStr = "[]";

    if (Array.isArray(data.payments) && data.payments.length > 0) {
      paymentsCount = data.payments.length;
      paidAmountNum = data.payments.reduce(function(acc, p) {
        return acc + (Number(String(p.amount || 0).replace(/[^\d.]/g, '')) || 0);
      }, 0);

      // حفظ تفاصيل الوصولات بدون صور Base64 الثقيلة لتجنب تجاوز حد الخلية
      var lightweightPayments = data.payments.map(function(p) {
        return {
          id: p.id,
          amount: p.amount,
          date: p.date,
          auditor: p.auditor,
          hasReceipt: !!p.receiptImage
        };
      });
      paymentsJsonStr = JSON.stringify(lightweightPayments);
    }

    var remainingNum = Math.max(0, totalFeeNum - paidAmountNum);

    // تحديد الحالة بدقة
    var statusText = data.status;
    if (!statusText || statusText === 'undefined') {
      if (totalFeeNum > 0) {
        if (paidAmountNum >= totalFeeNum) {
          statusText = "تم التسديد بالكامل";
        } else if (paidAmountNum > 0) {
          statusText = "مسدد جزئياً";
        } else {
          statusText = "لم يتم التسديد";
        }
      } else {
        statusText = paidAmountNum > 0 ? "تم التسديد بالكامل" : "معفى / نفقة عامة";
      }
    }

    var rowValues = [
      studentId,
      data.fullName || "",
      expenseType,
      data.department || "",
      data.studyType || "",
      data.specialization || "",
      data.admissionYear || "",
      data.graduationYear || "",
      totalFeeNum ? (totalFeeNum.toLocaleString() + " د.ع") : "0 د.ع",
      paidAmountNum ? (paidAmountNum.toLocaleString() + " د.ع") : "0 د.ع",
      remainingNum ? (remainingNum.toLocaleString() + " د.ع") : "0 د.ع",
      statusText,
      data.paymentDate || "-",
      data.auditorName || "-",
      data.createdAt || new Date().toLocaleString("ar-IQ"),
      paymentsCount + " وصولات",
      paymentsJsonStr
    ];

    if (rowIndexToUpdate > 0) {
      sheet.getRange(rowIndexToUpdate, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }

    sheet.autoResizeColumns(1, HEADERS.length);

    return ContentService.createTextOutput(JSON.stringify({
      result: "success",
      id: studentId,
      totalFee: totalFeeNum,
      paidAmount: paidAmountNum,
      remainingAmount: remainingNum,
      updated: rowIndexToUpdate > 0
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      result: "error",
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * دالة قراءة البيانات أو الحذف عبر GET
 */
function doGet(e) {
  try {
    var sheet = getTargetSheet();
    migrateAndEnsure17Columns(sheet);

    // دعم الحذف عبر GET
    if (e && e.parameter && e.parameter.action === 'delete') {
      var targetId = e.parameter.id;
      var deleted = deleteStudentById(targetId);
      return ContentService.createTextOutput(JSON.stringify({
        result: deleted ? "success" : "not_found",
        action: "delete",
        id: targetId
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // دعم تنظيف صفوف الاختبار عبر GET
    if (e && e.parameter && e.parameter.action === 'cleanTestRows') {
      cleanTestRows();
      return ContentService.createTextOutput(JSON.stringify({ result: "cleaned" })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }

    var result = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var id = String(row[0] || '').trim();
      var fullName = String(row[1] || '').trim();

      if (!id || !fullName || id.startsWith('TEST') || id.startsWith('STU-TEST') || id.startsWith('NON_EXISTENT')) continue;

      var expense = String(row[2] || '');
      var totalFeeVal = row[8];
      var totalFeeNum = Number(String(totalFeeVal || 0).replace(/[^\d.]/g, '')) || 0;
      if (totalFeeNum === 0 && expense === 'نفقة خاصة') {
        totalFeeNum = 3750000;
      }

      var paidAmountVal = row[9];
      var remainingVal = row[10];
      var statusVal = row[11];
      var paymentDateVal = row[12];
      var auditorVal = row[13];
      var createdAtVal = row[14];
      var paymentsJsonVal = row[16] || "[]";

      var paymentsArr = [];
      try {
        paymentsArr = JSON.parse(paymentsJsonVal);
      } catch (err) {
        paymentsArr = [];
      }

      result.push({
        id: id,
        fullName: fullName,
        expenseType: expense,
        department: String(row[3] || ''),
        studyType: String(row[4] || ''),
        specialization: String(row[5] || ''),
        admissionYear: String(row[6] || ''),
        graduationYear: String(row[7] || ''),
        totalFee: totalFeeNum,
        paidAmount: paidAmountVal,
        remainingAmount: remainingVal,
        status: String(statusVal || ''),
        paymentDate: String(paymentDateVal || ''),
        auditorName: String(auditorVal || ''),
        createdAt: String(createdAtVal || ''),
        payments: paymentsArr
      });
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
