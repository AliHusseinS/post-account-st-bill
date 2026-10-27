/**
 * كود Google Apps Script لربط النظام بـ Google Sheet تلقائياً
 * جدول البيانات المعتمد:
 * https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60/edit?usp=sharing
 * -------------------------------------------------------------
 * معرف الجدول (Spreadsheet ID):
 * 1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60
 */

var TARGET_SPREADSHEET_ID = "1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60";

function getTargetSheet() {
  try {
    if (SpreadsheetApp.getActiveSpreadsheet()) {
      return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    }
  } catch (e) {}
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID).getActiveSheet();
}

/**
 * دالة خزن وتعبئة بيانات الطلاب وبيانات الدفع في Google Sheet بنقرة واحدة
 * لتشغيلها: اختر دالة (populateInitialData) من القائمة المنسدلة في الأعلى واضغط على زر "Run / تشغيل"
 */
function populateInitialData() {
  var sheet = getTargetSheet();
  sheet.clear();
  sheet.setRightToLeft(true);
  
  var headers = [
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
  
  sheet.appendRow(headers);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#0f766e");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  
  var studentsData = [
    [
      "STU-2024-001",
      "حيدر علي جاسم الكناني",
      "نفقة خاصة",
      "علوم الحاسوب",
      "ماجستير",
      "الذكاء الاصطناعي وتعلم الآلة",
      "2023 - 2024",
      "2025 - 2026",
      "تم التسديد",
      "1,500,000 د.ع",
      "2024-10-15",
      "أ. مروان فالح حسن",
      "2024-10-10 10:30",
      "تم إرفاق صورة الوصل"
    ],
    [
      "STU-2024-002",
      "فاطمة محمد باقر الزبيدي",
      "نفقة خاصة",
      "الهندسة المدنية",
      "دكتوراه",
      "هندسة الإنشاءات والجسور",
      "2023 - 2024",
      "2026 - 2027",
      "لم يتم التسديد",
      "-",
      "-",
      "-",
      "2024-10-22 14:15",
      "لا يوجد"
    ],
    [
      "STU-2024-003",
      "كرار عبد الرضا مهدي العامري",
      "نفقة عامة",
      "إدارة الأعمال",
      "ماجستير - مسائي",
      "إدارة العمليات وسلاسل الإمداد",
      "2024 - 2025",
      "2026 - 2027",
      "تم التسديد",
      "750,000 د.ع",
      "2024-10-25",
      "م.م زينب حامد قاسم",
      "2024-10-20 09:00",
      "تم إرفاق صورة الوصل"
    ]
  ];
  
  for (var i = 0; i < studentsData.length; i++) {
    sheet.appendRow(studentsData[i]);
  }
  
  var dataRange = sheet.getDataRange();
  dataRange.setHorizontalAlignment("center");
  sheet.autoResizeColumns(1, headers.length);
  
  Logger.log("تم خزن بيانات الطلاب والتسديدات بنجاح في Google Sheet!");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    var sheet = getTargetSheet();
    var data = JSON.parse(e.postData.contents);
    
    // إذا كانت الورقة فارغة، ننشئ العناوين أولاً
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
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
        "رابط/صورة الوصل"
      ]);
      
      // تنسيق العناوين
      var headerRange = sheet.getRange(1, 1, 1, 14);
      headerRange.setBackground("#1e293b");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      sheet.setRightToLeft(true);
    }
    
    // فحص ما إذا كان الطالب موجوداً مسبقاً للتحديث، أو إضافة سطر جديد
    var studentId = data.id;
    var rows = sheet.getDataRange().getValues();
    var rowIndexToUpdate = -1;
    
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] == studentId) {
        rowIndexToUpdate = i + 1; // 1-based index
        break;
      }
    }
    
    var rowValues = [
      data.id || "",
      data.fullName || "",
      data.expenseType || "",
      data.department || "",
      data.studyType || "",
      data.specialization || "",
      data.admissionYear || "",
      data.graduationYear || "",
      data.isPaid ? "تم التسديد" : "لم يتم التسديد",
      data.paymentAmount ? data.paymentAmount + " د.ع" : "-",
      data.paymentDate || "-",
      data.auditorName || "-",
      data.createdAt || new Date().toLocaleString("ar-IQ"),
      data.receiptImage ? "تم إرفاق صورة الوصل" : "لا يوجد"
    ];
    
    if (rowIndexToUpdate > 0) {
      sheet.getRange(rowIndexToUpdate, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      result: "success",
      message: "تم حفظ البيانات بنجاح في Google Sheet",
      id: studentId
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

function doGet(e) {
  try {
    var sheet = getTargetSheet();
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = data[0];
    var result = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      result.push({
        id: row[0],
        fullName: row[1],
        expenseType: row[2],
        department: row[3],
        studyType: row[4],
        specialization: row[5],
        admissionYear: row[6],
        graduationYear: row[7],
        status: row[8],
        paymentAmount: row[9],
        paymentDate: row[10],
        auditorName: row[11],
        createdAt: row[12]
      });
    }
    
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
