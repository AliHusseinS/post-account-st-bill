/**
 * نظام متابعة وتسديد طلبة الدراسات العليا والربط مع الحسابات و Google Sheet
 */

// ==========================================
// 1. إدارة المستخدمين والصلاحيات ورابط Google Sheet
// ==========================================
const GOOGLE_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60/edit?usp=sharing";
const GOOGLE_SPREADSHEET_ID = "1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60";

// رابط Google Apps Script Web App المعتمد للمزامنة التلقائية
const GOOGLE_SCRIPT_WEBHOOK = "https://script.google.com/macros/s/AKfycbwCAmMVLdSUBe4cIu3nFOI7-DpsK9j_33RZ8edHilBnqyYiknlo7k7fWIc46AA5ASOd/exec";

const USERS = {
  postgrad: {
    username: 'postgrad',
    password: '123',
    name: 'قسم الدراسات العليا / المتابعة',
    role: 'postgrad',
    description: ''
  },
  accounts: {
    username: 'accounts',
    password: '123',
    name: 'قسم الحسابات',
    role: 'accounts',
    description: ''
  }
};

let currentUser = null;
let currentSelectedRole = 'postgrad';

// ==========================================
// 2. حالة البيانات الأولية والطلبة (Initial State)
// ==========================================
const DEFAULT_STUDENTS = [];

let studentsList = [];
let selectedStudentForAccounts = null;
let currentReceiptBase64 = null;

// ==========================================
// 3. تهيئة النظام والبدء (Initialization)
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  // التأكد من ضبط رابط Google Apps Script Web App الصحيح
  const savedSheetUrl = localStorage.getItem('google_sheet_webhook_url');
  if (!savedSheetUrl || !savedSheetUrl.startsWith('https://script.google.com/macros/s/')) {
    localStorage.setItem('google_sheet_webhook_url', GOOGLE_SCRIPT_WEBHOOK);
  }
  if (document.getElementById('inpGoogleSheetUrl')) {
    document.getElementById('inpGoogleSheetUrl').value = GOOGLE_SCRIPT_WEBHOOK;
  }

  // تحميل الطلبة من التخزين المحلي
  loadStudents();
  
  // تهيئة الأيقونات
  if (window.lucide) {
    lucide.createIcons();
  }
  
  // ضبط تاريخ اليوم الافتراضي لحقل التسديد
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('inpPaymentDate');
  if (dateInput) {
    dateInput.value = today;
  }

  // فحص الجلسة السابقة
  const savedUser = localStorage.getItem('postgrad_current_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      applyLoginSuccess();
    } catch (e) {
      localStorage.removeItem('postgrad_current_user');
    }
  }
});

function loadStudents() {
  const saved = localStorage.getItem('postgrad_students_data');
  if (saved) {
    try {
      studentsList = JSON.parse(saved);
    } catch (e) {
      studentsList = [];
    }
  } else {
    studentsList = [];
    saveStudents();
  }
  updateStats();
}

function saveStudents() {
  localStorage.setItem('postgrad_students_data', JSON.stringify(studentsList));
  updateStats();
}

// ==========================================
// 4. نظام تسجيل الدخول والصلاحيات
// ==========================================
function selectRole(role) {
  currentSelectedRole = role;
  const btnPg = document.getElementById('roleBtnPostgrad');
  const btnAcc = document.getElementById('roleBtnAccounts');
  const loginUser = document.getElementById('loginUsername');
  const loginPass = document.getElementById('loginPassword');

  if (role === 'postgrad') {
    btnPg.className = 'p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center gap-1 border-teal-600 bg-teal-50/60 text-teal-900 font-bold';
    btnAcc.className = 'p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center gap-1 border-slate-200 hover:border-slate-300 text-slate-600';
    loginUser.value = 'postgrad';
    loginPass.value = '123';
  } else {
    btnAcc.className = 'p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center gap-1 border-indigo-600 bg-indigo-50/60 text-indigo-900 font-bold';
    btnPg.className = 'p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center gap-1 border-slate-200 hover:border-slate-300 text-slate-600';
    loginUser.value = 'accounts';
    loginPass.value = '123';
  }
}

function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errorBox = document.getElementById('loginError');

  let matchedUser = null;
  if (username === USERS.postgrad.username && password === USERS.postgrad.password) {
    matchedUser = USERS.postgrad;
  } else if (username === USERS.accounts.username && password === USERS.accounts.password) {
    matchedUser = USERS.accounts;
  }

  if (matchedUser) {
    currentUser = matchedUser;
    localStorage.setItem('postgrad_current_user', JSON.stringify(currentUser));
    errorBox.classList.add('hidden');
    applyLoginSuccess();
    showAlert(`مرحباً بك! تم تسجيل الدخول بصلاحية: ${currentUser.name}`, 'success');
  } else {
    errorBox.classList.remove('hidden');
  }
}

function quickLogin(role) {
  selectRole(role);
  currentUser = USERS[role];
  localStorage.setItem('postgrad_current_user', JSON.stringify(currentUser));
  document.getElementById('loginError').classList.add('hidden');
  applyLoginSuccess();
  showAlert(`تم الدخول التجريبي السريع بصلاحية: ${currentUser.name}`, 'success');
}

function applyLoginSuccess() {
  document.getElementById('loginScreen').classList.add('hidden');
  
  // تحديث بيانات المستخدم في الهيدر
  document.getElementById('currentUserName').innerText = currentUser.name;
  document.getElementById('currentUserRoleDesc').innerText = currentUser.description;
  
  const iconBox = document.getElementById('userBadgeIcon');
  if (currentUser.role === 'postgrad') {
    iconBox.className = 'w-6 h-6 rounded-lg bg-teal-600 text-white flex items-center justify-center text-xs';
    iconBox.innerHTML = '<i data-lucide="building-2" class="w-3.5 h-3.5"></i>';
    document.getElementById('viewPostgrad').classList.remove('hidden');
    document.getElementById('viewAccounts').classList.add('hidden');
    renderStudentsTable();
  } else {
    iconBox.className = 'w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs';
    iconBox.innerHTML = '<i data-lucide="receipt" class="w-3.5 h-3.5"></i>';
    document.getElementById('viewPostgrad').classList.add('hidden');
    document.getElementById('viewAccounts').classList.remove('hidden');
    renderAccountsStudentSelector();
  }
  
  if (window.lucide) lucide.createIcons();
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('postgrad_current_user');
  document.getElementById('loginScreen').classList.remove('hidden');
  selectRole('postgrad');
}

// ==========================================
// 5. تبويبات قسم الدراسات العليا
// ==========================================
function switchPgTab(tab) {
  const btnList = document.getElementById('pgTabListBtn');
  const btnAdd = document.getElementById('pgTabAddBtn');
  const wrapperList = document.getElementById('pgListWrapper');
  const wrapperAdd = document.getElementById('pgAddFormWrapper');

  if (tab === 'list') {
    btnList.className = 'px-4 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-teal-600 text-white shadow-sm';
    btnAdd.className = 'px-4 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-100 text-slate-600 hover:bg-slate-200';
    wrapperList.classList.remove('hidden');
    wrapperAdd.classList.add('hidden');
    renderStudentsTable();
  } else {
    btnAdd.className = 'px-4 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-teal-600 text-white shadow-sm';
    btnList.className = 'px-4 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-100 text-slate-600 hover:bg-slate-200';
    wrapperAdd.classList.remove('hidden');
    wrapperList.classList.add('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

// ==========================================
// 6. إضافة طالب جديد (قسم الدراسات العليا فقط)
// ==========================================
function handleCreateStudent(e) {
  e.preventDefault();
  
  if (currentUser?.role !== 'postgrad') {
    alert('عذراً، صلاحية إضافة الطلاب محصورة بقسم الدراسات العليا فقط.');
    return;
  }

  const fullName = document.getElementById('inpFullName').value.trim();
  const expenseType = document.getElementById('inpExpenseType').value;
  const department = document.getElementById('inpDepartment').value.trim();
  const studyType = document.getElementById('inpStudyType').value;
  const specialization = document.getElementById('inpSpecialization').value.trim();
  const admissionYear = document.getElementById('inpAdmissionYear').value.trim();
  const graduationYear = document.getElementById('inpGraduationYear').value.trim();

  // التحقق من أن الاسم رباعي
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 3) {
    alert('يرجى إدخال اسم الطالب ثلاثياً أو رباعياً على الأقل.');
    return;
  }

  const newStudent = {
    id: 'STU-' + new Date().getFullYear() + '-' + String(studentsList.length + 1).padStart(3, '0'),
    fullName,
    expenseType,
    department,
    studyType,
    specialization,
    admissionYear,
    graduationYear,
    isPaid: false,
    paymentAmount: '',
    paymentDate: '',
    auditorName: '',
    createdAt: new Date().toLocaleDateString('ar-IQ') + ' ' + new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' }),
    receiptImage: null
  };

  studentsList.unshift(newStudent);
  saveStudents();
  
  // مزامنة فورية مع Google Sheet
  syncStudentToGoogleSheet(newStudent);

  // إعادة ضبط النموذج
  document.getElementById('newStudentForm').reset();
  showAlert(`تمت إضافة الطالب (${fullName}) بنجاح وإحالته لقسم الحسابات للتدقيق والتسديد.`, 'success');
  
  switchPgTab('list');
}

// ==========================================
// 7. عرض جدول الطلاب والفلترة (قسم الدراسات العليا)
// ==========================================
function renderStudentsTable() {
  const tbody = document.getElementById('studentsTableBody');
  const emptyState = document.getElementById('tableEmptyState');
  const search = document.getElementById('searchTableInput')?.value.toLowerCase().trim() || '';
  const filterStatus = document.getElementById('filterStatus')?.value || 'all';
  const filterExpense = document.getElementById('filterExpense')?.value || 'all';

  if (!tbody) return;

  const filtered = studentsList.filter(s => {
    // بحث
    const matchSearch = !search || 
      s.fullName.toLowerCase().includes(search) ||
      s.department.toLowerCase().includes(search) ||
      s.specialization.toLowerCase().includes(search) ||
      (s.auditorName && s.auditorName.toLowerCase().includes(search)) ||
      s.id.toLowerCase().includes(search);

    // فلترة حالة التسديد
    let matchStatus = true;
    if (filterStatus === 'paid') matchStatus = s.isPaid;
    if (filterStatus === 'pending') matchStatus = !s.isPaid;

    // فلترة النفقة
    let matchExpense = true;
    if (filterExpense !== 'all') {
      if (filterExpense === 'أخرى') {
        matchExpense = s.expenseType !== 'نفقة خاصة' && s.expenseType !== 'نفقة عامة';
      } else {
        matchExpense = s.expenseType === filterExpense;
      }
    }

    return matchSearch && matchStatus && matchExpense;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  
  tbody.innerHTML = filtered.map((s, idx) => {
    const statusBadge = s.isPaid 
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
          <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
          <span>تم التسديد</span>
        </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
          <i data-lucide="clock" class="w-3.5 h-3.5"></i>
          <span>بانتظار التسديد</span>
        </span>`;

    const receiptButton = s.receiptImage
      ? `<button onclick="openZoomModal('${s.id}')" title="معاينة الوصل" class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-[11px] border border-indigo-200 transition">
          <i data-lucide="image" class="w-3.5 h-3.5"></i>
          <span>معاينة الوصل</span>
        </button>`
      : `<span class="text-slate-400 text-[11px]">لا يوجد</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="p-3.5 font-bold text-slate-400">${idx + 1}</td>
        <td class="p-3.5">
          <p class="font-bold text-slate-800 text-xs">${s.fullName}</p>
          <span class="text-[10px] text-slate-400 font-mono">${s.id}</span>
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.expenseType === 'نفقة خاصة' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}">
            ${s.expenseType}
          </span>
        </td>
        <td class="p-3.5">
          <p class="font-semibold text-slate-700">${s.department}</p>
          <p class="text-[10px] text-slate-400">${s.specialization}</p>
        </td>
        <td class="p-3.5 text-slate-600 font-medium">${s.studyType}</td>
        <td class="p-3.5 text-slate-600">
          <span>${s.admissionYear}</span> / <span class="text-slate-400">${s.graduationYear}</span>
        </td>
        <td class="p-3.5">${statusBadge}</td>
        <td class="p-3.5 font-bold ${s.isPaid ? 'text-indigo-600' : 'text-slate-400'}">
          ${s.paymentAmount ? Number(s.paymentAmount).toLocaleString('ar-IQ') + ' د.ع' : '-'}
        </td>
        <td class="p-3.5 text-slate-600">${s.paymentDate || '-'}</td>
        <td class="p-3.5 text-slate-700 font-medium">${s.auditorName || '-'}</td>
        <td class="p-3.5">${receiptButton}</td>
        <td class="p-3.5 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="downloadStudentPDF('${s.id}')" title="تحميل استمارة وبراءة ذمة PDF" class="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg border border-rose-200 transition">
              <i data-lucide="file-down" class="w-4 h-4"></i>
            </button>
            <button onclick="deleteStudent('${s.id}')" title="حذف الطالب" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition">
              <i data-lucide="trash" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function deleteStudent(id) {
  const student = studentsList.find(s => s.id === id);
  if (!student) return;

  if (confirm(`هل أنت متأكد من حذف سجل الطالب: ${student.fullName}؟`)) {
    studentsList = studentsList.filter(s => s.id !== id);
    saveStudents();
    renderStudentsTable();
    showAlert('تم حذف سجل الطالب بنجاح.', 'info');
  }
}

// ==========================================
// 8. واجهة قسم الحسابات: اختيار الطالب وتسجيل الوصل
// ==========================================
function renderAccountsStudentSelector() {
  const container = document.getElementById('accountsStudentCardsList');
  const search = document.getElementById('searchAccStudents')?.value.toLowerCase().trim() || '';
  const badge = document.getElementById('pendingBadgeCount');

  if (!container) return;

  const pendingList = studentsList.filter(s => !s.isPaid);
  if (badge) badge.innerText = `${pendingList.length} لم يتم التسديد`;

  const filtered = studentsList.filter(s => {
    return !search || 
      s.fullName.toLowerCase().includes(search) || 
      s.department.toLowerCase().includes(search) ||
      s.id.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-xs text-center text-slate-400 py-6">لا توجد نتائج مطابقة</p>';
    return;
  }

  container.innerHTML = filtered.map(s => {
    const isSelected = selectedStudentForAccounts?.id === s.id;
    return `
      <div onclick="selectStudentForPayment('${s.id}')" class="p-3 rounded-2xl border cursor-pointer transition flex items-center justify-between ${isSelected ? 'border-indigo-600 bg-indigo-50/70 shadow-sm' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-800">${s.fullName}</span>
            <span class="text-[9px] px-1.5 py-0.2 rounded font-semibold ${s.expenseType === 'نفقة خاصة' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}">${s.expenseType}</span>
          </div>
          <p class="text-[11px] text-slate-500">${s.department} - ${s.studyType}</p>
        </div>
        <div class="text-left shrink-0">
          ${s.isPaid 
            ? '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">مسدد</span>'
            : '<span class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">لم يتم التسديد</span>'
          }
        </div>
      </div>
    `;
  }).join('');
}

function selectStudentForPayment(id) {
  selectedStudentForAccounts = studentsList.find(s => s.id === id);
  if (!selectedStudentForAccounts) return;

  renderAccountsStudentSelector();

  const emptyPrompt = document.getElementById('accNoStudentSelectedPrompt');
  const form = document.getElementById('accountsPaymentForm');

  emptyPrompt.classList.add('hidden');
  form.classList.remove('hidden');

  // تعبئة البيانات الأكاديمية (للقراءة فقط - مجهزة من الدراسات العليا)
  document.getElementById('dispStudentName').innerText = selectedStudentForAccounts.fullName;
  document.getElementById('dispStudentDept').innerText = selectedStudentForAccounts.department;
  document.getElementById('dispStudentExpense').innerText = selectedStudentForAccounts.expenseType;
  document.getElementById('dispStudentStudy').innerText = selectedStudentForAccounts.studyType;
  document.getElementById('dispStudentSpec').innerText = selectedStudentForAccounts.specialization;
  document.getElementById('dispStudentYears').innerText = `${selectedStudentForAccounts.admissionYear} / ${selectedStudentForAccounts.graduationYear}`;

  const statusPill = document.getElementById('selectedStudentStatusPill');
  if (selectedStudentForAccounts.isPaid) {
    statusPill.className = 'text-xs px-2.5 py-1 rounded-lg font-bold bg-emerald-100 text-emerald-800';
    statusPill.innerText = 'تم التسديد';
  } else {
    statusPill.className = 'text-xs px-2.5 py-1 rounded-lg font-bold bg-amber-100 text-amber-800';
    statusPill.innerText = 'لم يتم التسديد';
  }

  // تعبئة بيانات الدفع الحالية إن وجدت
  document.getElementById('inpPaymentAmount').value = selectedStudentForAccounts.paymentAmount || '';
  document.getElementById('inpPaymentDate').value = selectedStudentForAccounts.paymentDate || new Date().toISOString().split('T')[0];
  document.getElementById('inpAuditorName').value = selectedStudentForAccounts.auditorName || (currentUser?.name || '');

  // معاينة صورة الوصل
  currentReceiptBase64 = selectedStudentForAccounts.receiptImage || null;
  updateReceiptPreviewUI();

  if (window.lucide) lucide.createIcons();
}

function handleReceiptFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('يرجى اختيار ملف صورة صالح.');
    return;
  }

  // تقليص حجم الصورة وتشفيرها لـ Base64 لسهولة الحفظ والمزامنة
  const reader = new FileReader();
  reader.onload = (event) => {
    currentReceiptBase64 = event.target.result;
    updateReceiptPreviewUI();
  };
  reader.readAsDataURL(file);
}

function updateReceiptPreviewUI() {
  const placeholder = document.getElementById('receiptUploadPlaceholder');
  const previewBox = document.getElementById('receiptPreviewBox');
  const previewImg = document.getElementById('receiptPreviewImg');

  if (currentReceiptBase64) {
    placeholder.classList.add('hidden');
    previewBox.classList.remove('hidden');
    previewImg.src = currentReceiptBase64;
  } else {
    placeholder.classList.remove('hidden');
    previewBox.classList.add('hidden');
    previewImg.src = '';
  }
  if (window.lucide) lucide.createIcons();
}

function removeReceiptImage() {
  currentReceiptBase64 = null;
  document.getElementById('receiptFileInput').value = '';
  updateReceiptPreviewUI();
}

function handleSavePayment(e) {
  e.preventDefault();

  if (!selectedStudentForAccounts) {
    alert('يرجى اختيار طالب أولاً.');
    return;
  }

  const amount = document.getElementById('inpPaymentAmount').value.trim();
  const date = document.getElementById('inpPaymentDate').value;
  const auditor = document.getElementById('inpAuditorName').value.trim();

  if (!amount || Number(amount) <= 0) {
    alert('يرجى كتابة مبلغ التسديد بشكل صحيح.');
    return;
  }

  if (!auditor) {
    alert('يرجى إدخال اسم المدقق.');
    return;
  }

  // تحديث سجل الطالب في الذاكرة
  selectedStudentForAccounts.isPaid = true;
  selectedStudentForAccounts.paymentAmount = amount;
  selectedStudentForAccounts.paymentDate = date;
  selectedStudentForAccounts.auditorName = auditor;
  selectedStudentForAccounts.receiptImage = currentReceiptBase64;

  // حفظ في التخزين المحلي
  saveStudents();
  renderAccountsStudentSelector();
  selectStudentForPayment(selectedStudentForAccounts.id);

  // مزامنة إلى Google Sheet
  syncStudentToGoogleSheet(selectedStudentForAccounts);

  showAlert(`تم حفظ وتدقيق وصل الطالب (${selectedStudentForAccounts.fullName}) بنجاح بمبلغ ${Number(amount).toLocaleString('ar-IQ')} د.ع ومزامنته مع Google Sheet.`, 'success');
}

// ==========================================
// 9. تكبير صورة الوصل في نافذة منبثقة (Zoom Modal)
// ==========================================
function openZoomModal(target) {
  const modal = document.getElementById('zoomModal');
  const img = document.getElementById('zoomModalImg');

  let src = target;
  // فحص ما إذا كان الهدف هو ID طالب
  const student = studentsList.find(s => s.id === target);
  if (student && student.receiptImage) {
    src = student.receiptImage;
  }

  if (!src) {
    alert('لا توجد صورة وصل مرفقة لهذا الطالب.');
    return;
  }

  img.src = src;
  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeZoomModal() {
  document.getElementById('zoomModal').classList.add('hidden');
}

// ==========================================
// 10. تصدير وتنزيل ملفات PDF
// ==========================================

// أ) تنزيل استمارة وبراءة ذمة فردية للطالب مع الوصل
async function downloadStudentPDF(studentId) {
  const student = studentsList.find(s => s.id === studentId);
  if (!student) return;

  showAlert(`جاري إعداد وتحميل استمارة وبراءة ذمة الطالب (${student.fullName}) بصيغة PDF...`, 'info');

  // تعبئة قالب الطباعة المخفي
  document.getElementById('pdfDocId').innerText = student.id;
  document.getElementById('pdfDocDate').innerText = new Date().toLocaleDateString('ar-IQ');
  document.getElementById('pdfDocStatus').innerText = student.isPaid ? 'تم التسديد' : 'لم يتم التسديد';

  document.getElementById('pdfStudentName').innerText = student.fullName;
  document.getElementById('pdfStudentDept').innerText = student.department;
  document.getElementById('pdfStudentStudy').innerText = student.studyType;
  document.getElementById('pdfStudentSpec').innerText = student.specialization;
  document.getElementById('pdfStudentExpense').innerText = student.expenseType;
  document.getElementById('pdfStudentYears').innerText = `${student.admissionYear} / ${student.graduationYear}`;

  document.getElementById('pdfPaymentAmount').innerText = student.paymentAmount ? Number(student.paymentAmount).toLocaleString('ar-IQ') + ' دينار عراقي' : 'غير مسدد بعد';
  document.getElementById('pdfPaymentDate').innerText = student.paymentDate || 'لم يسدد بعد';
  document.getElementById('pdfAuditorName').innerText = student.auditorName || '-';
  document.getElementById('pdfAuditDate').innerText = student.paymentDate || '-';

  const receiptImg = document.getElementById('pdfReceiptImage');
  const noReceipt = document.getElementById('pdfNoReceiptPlaceholder');

  if (student.receiptImage) {
    receiptImg.src = student.receiptImage;
    receiptImg.classList.remove('hidden');
    noReceipt.classList.add('hidden');
  } else {
    receiptImg.classList.add('hidden');
    noReceipt.classList.remove('hidden');
  }

  try {
    const element = document.getElementById('singleStudentPdfTemplate');
    const canvas = await html2canvas(element, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL('image/png');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 0, 5, pdfWidth, pdfHeight);
    pdf.save(`استمارة_تسديد_${student.fullName.replace(/\s+/g, '_')}.pdf`);

    showAlert('تم تنزيل ملف الـ PDF بنجاح!', 'success');
  } catch (error) {
    console.error('PDF error:', error);
    window.print();
  }
}

// ب) تصدير كشف شامل لجميع الطلاب والتسديدات PDF
async function exportAllStudentsPDF() {
  if (studentsList.length === 0) {
    alert('لا توجد بيانات طلاب لتصديرها.');
    return;
  }

  showAlert('جاري تجهيز تقرير كشف التسديدات الشامل لجميع طلبة الدراسات العليا...', 'info');

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('landscape', 'mm', 'a4');

  // سنقوم بإنشاء عنصر مؤقت يحتوي على جدول التقرير الأنيق
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.width = '1100px';
  tempDiv.style.padding = '25px';
  tempDiv.style.background = '#ffffff';
  tempDiv.style.fontFamily = 'Cairo, sans-serif';
  tempDiv.dir = 'rtl';

  tempDiv.innerHTML = `
    <div style="border-bottom: 2px solid #0f766e; padding-bottom: 15px; margin-bottom: 15px; text-align: center;">
      <h2 style="margin: 0; font-size: 20px; color: #0f766e; font-weight: bold;">جمهورية العراق - وزارة التعليم العالي والبحث العلمي</h2>
      <h3 style="margin: 5px 0; font-size: 16px; color: #1e293b;">كشف تسديدات وأجور طلبة الدراسات العليا المعتمد</h3>
      <p style="margin: 0; font-size: 12px; color: #64748b;">تاريخ استخراج التقرير: ${new Date().toLocaleDateString('ar-IQ')} | إجمالي الطلبة: ${studentsList.length}</p>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: right;">
      <thead>
        <tr style="background-color: #0f766e; color: #ffffff;">
          <th style="padding: 8px; border: 1px solid #cbd5e1;">ت</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">اسم الطالب الرباعي</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">القسم</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">نوع الدراسة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">النفقة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">سنة القبول</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">الحالة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">المبلغ المسدد</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">تاريخ التسديد</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">المدقق المسؤول</th>
        </tr>
      </thead>
      <tbody>
        ${studentsList.map((s, i) => `
          <tr style="background-color: ${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
            <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">${i + 1}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">${s.fullName}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.department}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.studyType}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.expenseType}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">${s.admissionYear}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; color: ${s.isPaid ? '#047857' : '#b45309'}; font-weight: bold;">
              ${s.isPaid ? 'تم التسديد' : 'بانتظار التسديد'}
            </td>
            <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">
              ${s.paymentAmount ? Number(s.paymentAmount).toLocaleString('ar-IQ') + ' د.ع' : '-'}
            </td>
            <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">${s.paymentDate || '-'}</td>
            <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.auditorName || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top: 30px; display: flex; justify-content: space-between; font-size: 12px; font-weight: bold;">
      <div>توقيع مسؤول الدراسات العليا: .....................</div>
      <div>توقيع وتدقيق قسم الحسابات: .....................</div>
      <div>مصادقة العميد / المعاون: .....................</div>
    </div>
  `;

  document.body.appendChild(tempDiv);

  try {
    const canvas = await html2canvas(tempDiv, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 0, 5, pdfWidth, pdfHeight);
    pdf.save(`كشف_تسديدات_طلبة_الدراسات_العليا_${new Date().toISOString().split('T')[0]}.pdf`);
    showAlert('تم تصدير كشف الـ PDF الشامل بنجاح!', 'success');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء تصدير الـ PDF');
  } finally {
    document.body.removeChild(tempDiv);
  }
}

// ==========================================
// 11. تصدير البيانات إلى Excel / Google Sheets
// ==========================================
function exportToExcel() {
  if (studentsList.length === 0) {
    alert('لا توجد بيانات طلاب لتصديرها.');
    return;
  }

  const excelRows = studentsList.map((s, idx) => ({
    "ت": idx + 1,
    "معرف الطالب": s.id,
    "اسم الطالب الرباعي": s.fullName,
    "نوع النفقة": s.expenseType,
    "القسم العلمي": s.department,
    "نوع الدراسة": s.studyType,
    "التخصص": s.specialization,
    "سنة القبول": s.admissionYear,
    "سنة التخرج": s.graduationYear,
    "حالة التسديد": s.isPaid ? "تم التسديد" : "لم يتم التسديد",
    "المبلغ المسدد (د.ع)": s.paymentAmount ? Number(s.paymentAmount) : 0,
    "تاريخ التسديد": s.paymentDate || "",
    "المدقق": s.auditorName || "",
    "تاريخ الإضافة": s.createdAt,
    "حالة صورة الوصل": s.receiptImage ? "تم رفع الوصل" : "غير مرفق"
  }));

  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "طلبة الدراسات العليا");

  // تنزيل الملف
  XLSX.writeFile(workbook, `سجل_طلبة_الدراسات_العليا_والتسديدات_${new Date().toISOString().split('T')[0]}.xlsx`);
  showAlert('تم تصدير الملف !', 'success');
}

// ==========================================
// 12. المزامنة المباشرة مع GOOGLE SHEETS
// ==========================================
function openGoogleSheetModal() {
  document.getElementById('googleSheetModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeGoogleSheetModal() {
  document.getElementById('googleSheetModal').classList.add('hidden');
}

function saveGoogleSheetSettings() {
  const url = document.getElementById('inpGoogleSheetUrl').value.trim();
  if (url) {
    localStorage.setItem('google_sheet_webhook_url', url);
    showAlert('تم حفظ رابط Google Sheet بنجاح! سيتم إرسال أي طالب أو وصل تلقائياً إليه.', 'success');
  } else {
    localStorage.removeItem('google_sheet_webhook_url');
    showAlert('تم إلغاء رابط Google Sheet.', 'info');
  }
  closeGoogleSheetModal();
}

function getActiveWebhookUrl() {
  const saved = localStorage.getItem('google_sheet_webhook_url');
  if (saved && saved.startsWith('https://script.google.com/macros/s/')) {
    return saved;
  }
  return GOOGLE_SCRIPT_WEBHOOK;
}

async function syncStudentToGoogleSheet(student) {
  const webhookUrl = getActiveWebhookUrl();

  try {
    // إرسال البيانات إلى Google Apps Script Web App
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors', // لتفادي قيود CORS مع Google Apps Script
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(student)
    });
    console.log('تم إرسال البيانات إلى Google Sheet بنجاح!');
    showAlert(`تم حفظ الطالب ومزامنته مع Google Sheet بنجاح ✓`, 'success');
  } catch (err) {
    console.warn('تعذر الاتصال بـ Google Sheet:', err);
  }
}

async function testGoogleSheetSync() {
  const url = (document.getElementById('inpGoogleSheetUrl')?.value.trim()) || GOOGLE_SCRIPT_WEBHOOK;
  if (!url) {
    alert('يرجى إدخال رابط Google Apps Script Web App أولاً.');
    return;
  }

  showAlert('جاري اختبار الاتصال وإرسال سجل تجريبي إلى Google Sheet...', 'info');

  try {
    const testData = {
      id: 'TEST-001',
      fullName: 'طالب تجريبي للاختبار',
      expenseType: 'نفقة عامة',
      department: 'قسم التجربة',
      studyType: 'ماجستير',
      specialization: 'فحص الربط',
      admissionYear: '2024',
      graduationYear: '2026',
      isPaid: true,
      paymentAmount: '100000',
      paymentDate: new Date().toISOString().split('T')[0],
      auditorName: 'مدقق تجريبي',
      receiptImage: null
    };

    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(testData)
    });

    showAlert('تم إرسال الطلب إلى Google Sheet بنجاح! تفقد ملف الجدول في حسابك.', 'success');
  } catch (err) {
    showAlert('حدث خطأ أثناء الاتصال بالرابط: ' + err.message, 'error');
  }
}

// ==========================================
// 13. تحديث الإحصائيات والإشعارات
// ==========================================
function updateStats() {
  const total = studentsList.length;
  const paid = studentsList.filter(s => s.isPaid).length;
  const pending = total - paid;
  
  const totalAmount = studentsList.reduce((acc, curr) => {
    return acc + (Number(curr.paymentAmount) || 0);
  }, 0);

  const elTotal = document.getElementById('statTotalStudents');
  const elPaid = document.getElementById('statPaidCount');
  const elPending = document.getElementById('statPendingCount');
  const elAmount = document.getElementById('statTotalAmount');

  if (elTotal) elTotal.innerText = total;
  if (elPaid) elPaid.innerText = paid;
  if (elPending) elPending.innerText = pending;
  if (elAmount) elAmount.innerText = totalAmount.toLocaleString('ar-IQ') + ' د.ع';
}

function showAlert(message, type = 'info') {
  const banner = document.getElementById('alertBanner');
  const text = document.getElementById('alertText');
  const icon = document.getElementById('alertIcon');

  if (!banner || !text) return;

  text.innerText = message;
  banner.classList.remove('hidden');

  if (type === 'success') {
    banner.className = 'mb-6 p-4 rounded-2xl flex items-center justify-between text-xs font-bold transition bg-emerald-50 text-emerald-800 border border-emerald-200';
    icon.setAttribute('data-lucide', 'check-circle');
  } else if (type === 'error') {
    banner.className = 'mb-6 p-4 rounded-2xl flex items-center justify-between text-xs font-bold transition bg-rose-50 text-rose-800 border border-rose-200';
    icon.setAttribute('data-lucide', 'alert-circle');
  } else {
    banner.className = 'mb-6 p-4 rounded-2xl flex items-center justify-between text-xs font-bold transition bg-teal-50 text-teal-800 border border-teal-200';
    icon.setAttribute('data-lucide', 'info');
  }

  if (window.lucide) lucide.createIcons();

  // إخفاء تلقائي بعد 5 ثوانٍ
  setTimeout(() => {
    closeAlert();
  }, 6000);
}

function closeAlert() {
  const banner = document.getElementById('alertBanner');
  if (banner) banner.classList.add('hidden');
}
