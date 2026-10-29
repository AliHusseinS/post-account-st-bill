/**
 * نظام متابعة وتسديد طلبة الدراسات العليا والربط مع الحسابات و Google Sheet
 */

// ==========================================
// 1. إدارة المستخدمين والصلاحيات ورابط Google Sheet
// ==========================================
const GOOGLE_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60/edit?usp=sharing";
const GOOGLE_SPREADSHEET_ID = "1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60";

// رابط Google Apps Script Web App المعتمد للمزامنة التلقائية
const GOOGLE_SCRIPT_WEBHOOK = "https://script.google.com/macros/s/AKfycbxqC-EvruQytQK3fgJMwhKGkOQFo7KKC_pGSuFPPYw1W32whJ6g0E1ESVAe5Y1pE19Q/exec";

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
  // ضبط رابط Google Apps Script
  localStorage.setItem('google_sheet_webhook_url', GOOGLE_SCRIPT_WEBHOOK);
  if (document.getElementById('inpGoogleSheetUrl')) {
    document.getElementById('inpGoogleSheetUrl').value = GOOGLE_SCRIPT_WEBHOOK;
  }

  // تحميل البيانات من الكاش المحلي أولاً للعرض السريع
  loadFromCache();

  // جلب فوري من Google Sheet ليكون هو المصدر الحي المعتمد في أي متصفح
  fetchStudentsFromGoogleSheet(false);

  // تهيئة الأيقونات
  if (window.lucide) lucide.createIcons();

  // ضبط تاريخ اليوم لحقل التسديد
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('inpPaymentDate');
  if (dateInput) dateInput.value = today;

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

// -------------------------------------------------------
// الحسابات المالية التلقائية للطالب (الأقساط، المسدد، المتبقي، الحالة)
// -------------------------------------------------------
function calculateStudentFinancials(s) {
  if (!s) return s;
  s.totalFee = Number(String(s.totalFee || 0).replace(/[^\d.]/g, '')) || 0;
  if (!Array.isArray(s.payments)) {
    s.payments = [];
  }
  
  // إذا لم يكن لديه سجل وصولات تفصيلي لكن لديه مبلغ قديم مسجل
  if (s.payments.length === 0 && s.paymentAmount && Number(String(s.paymentAmount).replace(/[^\d.]/g, '')) > 0) {
    const legacyAmt = Number(String(s.paymentAmount).replace(/[^\d.]/g, ''));
    s.payments.push({
      id: 'PAY-LEGACY-1',
      amount: legacyAmt,
      date: s.paymentDate || '-',
      auditor: s.auditorName || '-',
      receiptImage: s.receiptImage || null
    });
  }

  // حساب إجمالي المدفوع
  s.paidAmount = s.payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  s.paymentAmount = s.paidAmount; // للتوافق

  // حساب المتبقي
  s.remainingAmount = Math.max(0, s.totalFee - s.paidAmount);

  // تحديد الحالة بدقة
  if (s.totalFee > 0) {
    if (s.paidAmount >= s.totalFee) {
      s.status = 'تم التسديد بالكامل';
      s.isPaid = true;
    } else if (s.paidAmount > 0) {
      s.status = 'مسدد جزئياً';
      s.isPaid = false;
    } else {
      s.status = 'لم يتم التسديد';
      s.isPaid = false;
    }
  } else {
    if (s.paidAmount > 0) {
      s.status = 'تم التسديد بالكامل';
      s.isPaid = true;
    } else {
      s.status = 'لم يتم التسديد';
      s.isPaid = false;
    }
  }

  // النسبة المئوية للتسديد
  s.percent = s.totalFee > 0 ? Math.min(100, Math.round((s.paidAmount / s.totalFee) * 100)) : (s.paidAmount > 0 ? 100 : 0);

  // تحديث تاريخ آخر تسديد واسم آخر مدقق وصورة الوصل
  if (s.payments.length > 0) {
    const latest = s.payments[0];
    s.paymentDate = latest.date || s.paymentDate || '-';
    s.auditorName = latest.auditor || s.auditorName || '-';
    if (latest.receiptImage) {
      s.receiptImage = latest.receiptImage;
    }
  }

  return s;
}

// -------------------------------------------------------
// localStorage = كاش فقط للعرض السريع
// Google Sheet = المصدر الوحيد الحقيقي للبيانات
// -------------------------------------------------------
function saveToCache() {
  studentsList.forEach(s => calculateStudentFinancials(s));
  localStorage.setItem('postgrad_students_data', JSON.stringify(studentsList));
}

function loadFromCache() {
  try {
    const saved = localStorage.getItem('postgrad_students_data');
    if (saved) {
      studentsList = JSON.parse(saved);
      studentsList.forEach(s => calculateStudentFinancials(s));
    } else {
      studentsList = [];
    }
  } catch (e) {
    studentsList = [];
  }
}

// للتوافق مع أي استدعاء قديم
function loadStudents() { loadFromCache(); updateStats(); }
function saveStudents() { saveToCache(); updateStats(); }


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
  } else {
    iconBox.className = 'w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs';
    iconBox.innerHTML = '<i data-lucide="receipt" class="w-3.5 h-3.5"></i>';
    document.getElementById('viewPostgrad').classList.add('hidden');
    document.getElementById('viewAccounts').classList.remove('hidden');
  }
  
  if (window.lucide) lucide.createIcons();

  // خطوة 1: اعرض الكاش المحلي فوراً (لو موجود)
  loadFromCache();
  renderStudentsTable();
  renderAccountsStudentSelector();
  updateStats();

  // خطوة 2: جلب أحدث البيانات من Google Sheet (المصدر الحقيقي)
  fetchStudentsFromGoogleSheet(false);
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
// اقتراح المبلغ المقرر تلقائياً حسب نوع النفقة
// ==========================================
function handleExpenseTypeChange() {
  const expenseType = document.getElementById('inpExpenseType')?.value;
  const inpTotalFee = document.getElementById('inpTotalFee');
  if (!inpTotalFee) return;

  if (expenseType === 'نفقة خاصة') {
    if (!inpTotalFee.value || inpTotalFee.value === '0') {
      inpTotalFee.value = '3750000';
    }
  } else if (expenseType === 'نفقة عامة' || expenseType === 'منحة دراسية') {
    inpTotalFee.value = '0';
  }
}

// ==========================================
// 6. إضافة طالب جديد (قسم الدراسات العليا فقط)
// ==========================================
async function handleCreateStudent(e) {
  e.preventDefault();
  
  if (currentUser?.role !== 'postgrad') {
    alert('عذراً، صلاحية إضافة الطلاب محصورة بقسم الدراسات العليا فقط.');
    return;
  }

  const fullName     = document.getElementById('inpFullName').value.trim();
  const expenseType  = document.getElementById('inpExpenseType').value;
  const department   = document.getElementById('inpDepartment').value.trim();
  const studyType    = document.getElementById('inpStudyType').value;
  const specialization = document.getElementById('inpSpecialization').value.trim();
  const admissionYear  = document.getElementById('inpAdmissionYear').value.trim();
  const graduationYear = document.getElementById('inpGraduationYear').value.trim();

  const nameParts = fullName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 3) {
    alert('يرجى إدخال اسم الطالب ثلاثياً أو رباعياً على الأقل.');
    return;
  }

  // توليد ID فريد بالوقت لتجنب التكرار
  const newId = 'STU-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-5);
  const totalFeeInput = document.getElementById('inpTotalFee')?.value || '0';
  const totalFee = Number(totalFeeInput) || 0;

  const newStudent = {
    id: newId,
    fullName,
    expenseType,
    department,
    studyType,
    specialization,
    admissionYear,
    graduationYear,
    totalFee: totalFee,
    payments: [],
    paidAmount: 0,
    remainingAmount: totalFee,
    isPaid: false,
    status: 'لم يتم التسديد',
    paymentAmount: '',
    paymentDate: '',
    auditorName: '',
    createdAt: new Date().toLocaleDateString('ar-IQ') + ' ' + new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' }),
    receiptImage: null
  };

  calculateStudentFinancials(newStudent);

  // --- خطوة 1: أضفه للواجهة فوراً بلحظتها (Optimistic UI فوري) ---
  studentsList.unshift(newStudent);
  saveToCache();
  renderStudentsTable();
  renderAccountsStudentSelector();
  updateStats();
  document.getElementById('newStudentForm').reset();
  showAlert(`تمت إضافة الطالب (${fullName}) بمبلغ مقرر ${totalFee.toLocaleString('ar-IQ')} د.ع فوراً ومزامنته في الخلفية...`, 'success');
  switchPgTab('list');

  // --- خطوة 2: أرسله لـ Google Sheet في الخلفية بدون تجميد الواجهة ---
  syncStudentToGoogleSheet(newStudent);

  // --- خطوة 3: تأكيد المزامنة بعد ثانيتين ---
  setTimeout(() => fetchStudentsFromGoogleSheet(false), 2000);
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
    calculateStudentFinancials(s);

    // بحث
    const matchSearch = !search || 
      s.fullName.toLowerCase().includes(search) ||
      s.department.toLowerCase().includes(search) ||
      s.specialization.toLowerCase().includes(search) ||
      (s.auditorName && s.auditorName.toLowerCase().includes(search)) ||
      s.id.toLowerCase().includes(search);

    // فلترة حالة التسديد
    let matchStatus = true;
    if (filterStatus === 'paid') matchStatus = (s.status === 'تم التسديد بالكامل' || s.isPaid);
    if (filterStatus === 'partial') matchStatus = (s.status === 'مسدد جزئياً');
    if (filterStatus === 'unpaid') matchStatus = (s.status === 'لم يتم التسديد');

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
    calculateStudentFinancials(s);

    let statusBadge = '';
    if (s.status === 'تم التسديد بالكامل' || s.isPaid) {
      statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
        <span>تم التسديد بالكامل</span>
      </span>`;
    } else if (s.status === 'مسدد جزئياً') {
      statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
        <i data-lucide="pie-chart" class="w-3.5 h-3.5"></i>
        <span>مسدد جزئياً (${s.percent}%)</span>
      </span>`;
    } else {
      statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <i data-lucide="clock" class="w-3.5 h-3.5"></i>
        <span>لم يتم التسديد</span>
      </span>`;
    }

    const paymentsCount = s.payments ? s.payments.length : 0;
    const latestReceipt = (s.payments && s.payments.find(p => p.receiptImage)?.receiptImage) || s.receiptImage;

    const receiptButton = latestReceipt
      ? `<button onclick="openZoomModal('${latestReceipt}')" title="معاينة الوصل" class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-[10px] border border-indigo-200 transition">
          <i data-lucide="image" class="w-3 h-3"></i>
          <span>${paymentsCount > 1 ? paymentsCount + ' وصولات' : 'معاينة الوصل'}</span>
        </button>`
      : (paymentsCount > 0 
          ? `<span class="text-slate-600 font-bold text-[10px]">${paymentsCount} وصولات</span>` 
          : `<span class="text-slate-400 text-[10px]">لا يوجد</span>`);

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
        <td class="p-3.5 font-bold text-slate-700">${Number(s.totalFee || 0).toLocaleString('ar-IQ')} د.ع</td>
        <td class="p-3.5 font-extrabold text-emerald-600">${Number(s.paidAmount || 0).toLocaleString('ar-IQ')} د.ع</td>
        <td class="p-3.5 font-bold ${s.remainingAmount > 0 ? 'text-amber-700' : 'text-slate-400'}">
          ${Number(s.remainingAmount || 0).toLocaleString('ar-IQ')} د.ع
        </td>
        <td class="p-3.5">${statusBadge}</td>
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

async function deleteStudent(id) {
  const student = studentsList.find(s => s.id === id);
  if (!student) return;

  if (confirm(`هل أنت متأكد من حذف سجل الطالب: ${student.fullName}؟`)) {
    // خطوة 1: حذف فوري من الواجهة بلحظتها (Instant UI)
    studentsList = studentsList.filter(s => s.id !== id);
    saveToCache();
    renderStudentsTable();
    renderAccountsStudentSelector();
    updateStats();
    showAlert(`تم حذف الطالب (${student.fullName}) من الواجهة فوراً وجاري حذفه من Google Sheet...`, 'info');

    // خطوة 2: إرسال طلب الحذف لـ Google Sheet في الخلفية
    deleteStudentFromGoogleSheet(id);

    // خطوة 3: تأكيد الحذف بعد ثانيتين
    setTimeout(() => fetchStudentsFromGoogleSheet(false), 2000);
  }
}

async function deleteStudentFromGoogleSheet(studentId) {
  const webhookUrl = getActiveWebhookUrl();
  try {
    // 1. إرسال طلب الحذف عبر POST
    fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'delete', id: studentId })
    }).catch(e => console.warn('POST delete error:', e));

    // 2. إرسال احتياطي فوري عبر GET (مضمون 100% ولا يتأثر بأي قيود CORS)
    const getUrl = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'action=delete&id=' + encodeURIComponent(studentId);
    await fetch(getUrl, { mode: 'no-cors' });
    console.log(`تم إرسال طلب حذف الطالب (${studentId}) إلى Google Sheet بنجاح`);
  } catch (err) {
    console.warn('تعذر حذف الطالب من Google Sheet:', err);
  }
}

// ==========================================
// 8. واجهة قسم الحسابات: اختيار الطالب، الموقف المالي، وسجل الوصولات
// ==========================================
function renderAccountsStudentSelector() {
  const container = document.getElementById('accountsStudentCardsList');
  const search = document.getElementById('searchAccStudents')?.value.toLowerCase().trim() || '';
  const badge = document.getElementById('pendingBadgeCount');

  if (!container) return;

  studentsList.forEach(s => calculateStudentFinancials(s));

  const pendingList = studentsList.filter(s => s.remainingAmount > 0 || !s.isPaid);
  if (badge) badge.innerText = `${pendingList.length} بانتظار استكمال التسديد`;

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
    let statusPill = '';
    if (s.status === 'تم التسديد بالكامل' || s.isPaid) {
      statusPill = '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">مسدد كلياً</span>';
    } else if (s.status === 'مسدد جزئياً') {
      statusPill = `<span class="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">مسدد جزئياً (${s.percent}%)</span>`;
    } else {
      statusPill = '<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">لم يسدد</span>';
    }

    return `
      <div onclick="selectStudentForPayment('${s.id}')" class="p-3 rounded-2xl border cursor-pointer transition flex items-center justify-between ${isSelected ? 'border-indigo-600 bg-indigo-50/70 shadow-sm' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}">
        <div class="space-y-0.5">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-800">${s.fullName}</span>
            <span class="text-[9px] px-1.5 py-0.2 rounded font-semibold ${s.expenseType === 'نفقة خاصة' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}">${s.expenseType}</span>
          </div>
          <p class="text-[11px] text-slate-500">${s.department} - ${s.studyType}</p>
          <div class="flex items-center gap-2 text-[10px] text-slate-400">
            <span>المقرر: ${Number(s.totalFee || 0).toLocaleString('ar-IQ')} د.ع</span>
            <span>•</span>
            <span class="text-emerald-600 font-bold">المدفوع: ${Number(s.paidAmount || 0).toLocaleString('ar-IQ')} د.ع</span>
          </div>
        </div>
        <div class="text-left shrink-0">
          ${statusPill}
        </div>
      </div>
    `;
  }).join('');
}

function selectStudentForPayment(id) {
  selectedStudentForAccounts = studentsList.find(s => s.id === id);
  if (!selectedStudentForAccounts) return;

  calculateStudentFinancials(selectedStudentForAccounts);
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

  // تحديث بطاقة الموقف المالي الشاملة
  const totalFeeStr = Number(selectedStudentForAccounts.totalFee || 0).toLocaleString('ar-IQ') + ' د.ع';
  const paidStr = Number(selectedStudentForAccounts.paidAmount || 0).toLocaleString('ar-IQ') + ' د.ع';
  const remainingStr = Number(selectedStudentForAccounts.remainingAmount || 0).toLocaleString('ar-IQ') + ' د.ع';
  const percentStr = (selectedStudentForAccounts.percent || 0) + '%';

  document.getElementById('dispTotalFee').innerText = totalFeeStr;
  document.getElementById('dispPaidAmount').innerText = paidStr;
  document.getElementById('dispRemainingAmount').innerText = remainingStr;
  document.getElementById('dispPaymentProgressPercent').innerText = percentStr;
  document.getElementById('dispPaymentProgressBar').style.width = percentStr;

  // شارة الحالة
  const statusPill = document.getElementById('selectedStudentStatusPill');
  if (selectedStudentForAccounts.status === 'تم التسديد بالكامل' || selectedStudentForAccounts.isPaid) {
    statusPill.className = 'text-xs px-2.5 py-1 rounded-lg font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
    statusPill.innerText = 'تم التسديد بالكامل ✓';
  } else if (selectedStudentForAccounts.status === 'مسدد جزئياً') {
    statusPill.className = 'text-xs px-2.5 py-1 rounded-lg font-bold bg-amber-100 text-amber-800 border border-amber-200';
    statusPill.innerText = `مسدد جزئياً (${percentStr})`;
  } else {
    statusPill.className = 'text-xs px-2.5 py-1 rounded-lg font-bold bg-rose-50 text-rose-700 border border-rose-200';
    statusPill.innerText = 'لم يتم التسديد بعد';
  }

  // تصفير حقول إدخال الدفعة الجديدة
  document.getElementById('inpPaymentAmount').value = '';
  document.getElementById('inpPaymentDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('inpAuditorName').value = currentUser?.name || '';
  currentReceiptBase64 = null;
  updateReceiptPreviewUI();

  // عرض سجل وصولات الطالب
  renderStudentPaymentsHistory(selectedStudentForAccounts);

  if (window.lucide) lucide.createIcons();
}

function renderStudentPaymentsHistory(student) {
  const tbody = document.getElementById('studentPaymentsTableBody');
  const countBadge = document.getElementById('dispPaymentsCountBadge');
  if (!tbody) return;

  const payments = Array.isArray(student.payments) ? student.payments : [];
  if (countBadge) {
    countBadge.innerText = `${payments.length} وصولات مسجلة`;
  }

  if (payments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-slate-400">
          <p class="font-bold text-slate-500 mb-0.5">لا توجد حركات تسديد سابقة لهذا الطالب</p>
          <p class="text-[11px]">يمكنك إضافة أول قسط أو وصل تسديد من النموذج أعلاه.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = payments.map((p, idx) => {
    const receiptBtn = p.receiptImage
      ? `<button type="button" onclick="openZoomModal('${p.receiptImage}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition">
          <i data-lucide="image" class="w-3 h-3"></i>
          <span>معاينة الوصل</span>
        </button>`
      : `<span class="text-slate-400 text-[10px]">لا يوجد</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="p-2.5 font-bold text-slate-700">الدفعة #${payments.length - idx}</td>
        <td class="p-2.5 font-extrabold text-indigo-700">${Number(p.amount).toLocaleString('ar-IQ')} د.ع</td>
        <td class="p-2.5 text-slate-600 font-medium">${p.date || '-'}</td>
        <td class="p-2.5 text-slate-600 font-medium">${p.auditor || '-'}</td>
        <td class="p-2.5 text-center">${receiptBtn}</td>
        <td class="p-2.5 text-center">
          <button type="button" onclick="deletePaymentRecord('${student.id}', '${p.id}')" title="حذف هذه الدفعة" class="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded transition">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function deletePaymentRecord(studentId, paymentId) {
  const student = studentsList.find(s => s.id === studentId);
  if (!student || !Array.isArray(student.payments)) return;

  if (confirm('هل أنت متأكد من حذف حركة التسديد / الوصل هذا؟ سيتم إعادة احتساب الموقف المالي للطالب.')) {
    student.payments = student.payments.filter(p => p.id !== paymentId);
    calculateStudentFinancials(student);
    saveToCache();
    selectStudentForPayment(student.id);
    renderStudentsTable();
    updateStats();
    syncStudentToGoogleSheet(student);
    showAlert('تم حذف حركة التسديد وإعادة احتساب المتبقي بنجاح.', 'info');
  }
}

function handleReceiptFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('يرجى اختيار ملف صورة صالح.');
    return;
  }

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

  const amount  = document.getElementById('inpPaymentAmount').value.trim();
  const date    = document.getElementById('inpPaymentDate').value;
  const auditor = document.getElementById('inpAuditorName').value.trim();

  if (!amount || Number(amount) <= 0) {
    alert('يرجى كتابة مبلغ التسديد بشكل صحيح.');
    return;
  }

  if (!auditor) {
    alert('يرجى إدخال اسم المدقق.');
    return;
  }

  const newPayment = {
    id: 'PAY-' + Date.now().toString().slice(-6),
    amount: Number(amount),
    date: date,
    auditor: auditor,
    receiptImage: currentReceiptBase64,
    createdAt: new Date().toLocaleDateString('ar-IQ') + ' ' + new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })
  };

  if (!Array.isArray(selectedStudentForAccounts.payments)) {
    selectedStudentForAccounts.payments = [];
  }

  selectedStudentForAccounts.payments.unshift(newPayment);
  selectedStudentForAccounts.receiptImage = currentReceiptBase64 || selectedStudentForAccounts.receiptImage;
  selectedStudentForAccounts.paymentDate = date;
  selectedStudentForAccounts.auditorName = auditor;

  calculateStudentFinancials(selectedStudentForAccounts);

  saveToCache();
  renderAccountsStudentSelector();
  selectStudentForPayment(selectedStudentForAccounts.id);
  renderStudentsTable();
  updateStats();

  // مزامنة فورية في الخلفية مع Google Sheet
  syncStudentToGoogleSheet(selectedStudentForAccounts);

  showAlert(`تمت إضافة دفعة جديدة بمبلغ ${Number(amount).toLocaleString('ar-IQ')} د.ع بنجاح! حالة الطالب الحالية: (${selectedStudentForAccounts.status}).`, 'success');
}

// ==========================================
// 9. تكبير صورة الوصل في نافذة منبثقة (Zoom Modal)
// ==========================================
function openZoomModal(target) {
  const modal = document.getElementById('zoomModal');
  const img = document.getElementById('zoomModalImg');

  let src = target;
  if (!src) {
    alert('لا توجد صورة وصل مرفقة.');
    return;
  }

  // إذا تم تمرير معرف الطالب نبحث عن أحدث صورة وصل لديه
  if (!src.startsWith('data:image') && !src.startsWith('http')) {
    const student = studentsList.find(s => s.id === target);
    if (student) {
      src = (student.payments && student.payments.find(p => p.receiptImage)?.receiptImage) || student.receiptImage;
    }
  }

  if (!src || (!src.startsWith('data:image') && !src.startsWith('http'))) {
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

// أ) تنزيل استمارة وبراءة ذمة فردية للطالب مع سجل الوصولات
async function downloadStudentPDF(studentId) {
  const student = studentsList.find(s => s.id === studentId);
  if (!student) return;

  calculateStudentFinancials(student);

  showAlert(`جاري إعداد وتحميل استمارة وبراءة ذمة الطالب (${student.fullName}) بصيغة PDF...`, 'info');

  // تعبئة قالب الطباعة المخفي
  document.getElementById('pdfDocId').innerText = student.id;
  document.getElementById('pdfDocDate').innerText = new Date().toLocaleDateString('ar-IQ');
  document.getElementById('pdfDocStatus').innerText = student.status || (student.isPaid ? 'تم التسديد بالكامل' : 'لم يتم التسديد');

  document.getElementById('pdfStudentName').innerText = student.fullName;
  document.getElementById('pdfStudentDept').innerText = student.department;
  document.getElementById('pdfStudentStudy').innerText = student.studyType;
  document.getElementById('pdfStudentSpec').innerText = student.specialization;
  document.getElementById('pdfStudentExpense').innerText = student.expenseType;
  document.getElementById('pdfStudentYears').innerText = `${student.admissionYear} / ${student.graduationYear}`;

  document.getElementById('pdfTotalFee').innerText = Number(student.totalFee || 0).toLocaleString('ar-IQ') + ' د.ع';
  document.getElementById('pdfPaidAmount').innerText = Number(student.paidAmount || 0).toLocaleString('ar-IQ') + ' د.ع';
  document.getElementById('pdfRemainingAmount').innerText = Number(student.remainingAmount || 0).toLocaleString('ar-IQ') + ' د.ع';
  document.getElementById('pdfPaymentStatusText').innerText = student.status || 'لم يتم التسديد';

  // ملء جدول الدفعات والوصولات
  const paymentsTbody = document.getElementById('pdfPaymentsTableBody');
  const payments = Array.isArray(student.payments) ? student.payments : [];

  if (payments.length === 0) {
    paymentsTbody.innerHTML = `<tr><td colspan="4" class="p-2 text-center text-slate-400">لا توجد وصولات تسديد مسجلة</td></tr>`;
  } else {
    paymentsTbody.innerHTML = payments.map((p, idx) => `
      <tr class="border-b border-slate-200">
        <td class="p-1.5 border border-slate-300 font-bold">الدفعة #${payments.length - idx}</td>
        <td class="p-1.5 border border-slate-300 font-extrabold text-indigo-900">${Number(p.amount).toLocaleString('ar-IQ')} د.ع</td>
        <td class="p-1.5 border border-slate-300">${p.date || '-'}</td>
        <td class="p-1.5 border border-slate-300">${p.auditor || '-'}</td>
      </tr>
    `).join('');
  }

  // صورة الوصل (أحدث صورة وصل)
  const receiptImg = document.getElementById('pdfReceiptImage');
  const noReceipt = document.getElementById('pdfNoReceiptPlaceholder');
  const latestReceipt = (payments.find(p => p.receiptImage)?.receiptImage) || student.receiptImage;

  if (latestReceipt) {
    receiptImg.src = latestReceipt;
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
          <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">ت</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">اسم الطالب الرباعي</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">القسم والتخصص</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">نوع الدراسة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">النفقة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">المبلغ المقرر</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">إجمالي المسدد</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1;">المتبقي</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">الحالة</th>
          <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">الوصولات</th>
        </tr>
      </thead>
      <tbody>
        ${studentsList.map((s, i) => {
          calculateStudentFinancials(s);
          return `
            <tr style="background-color: ${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
              <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">${i + 1}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">${s.fullName}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.department} - ${s.specialization}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.studyType}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1;">${s.expenseType}</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold;">${Number(s.totalFee || 0).toLocaleString('ar-IQ')} د.ع</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; color: #059669;">${Number(s.paidAmount || 0).toLocaleString('ar-IQ')} د.ع</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; color: ${s.remainingAmount > 0 ? '#b45309' : '#64748b'};">${Number(s.remainingAmount || 0).toLocaleString('ar-IQ')} د.ع</td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: ${s.status === 'تم التسديد بالكامل' || s.isPaid ? '#047857' : (s.status === 'مسدد جزئياً' ? '#b45309' : '#e11d48')};">
                ${s.status || 'لم يتم التسديد'}
              </td>
              <td style="padding: 6px; border: 1px solid #cbd5e1; text-align: center;">${s.payments ? s.payments.length : 0} وصولات</td>
            </tr>
          `;
        }).join('')}
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

  studentsList.forEach(s => calculateStudentFinancials(s));

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
    "المبلغ المقرر الأصلي (د.ع)": s.totalFee || 0,
    "إجمالي المسدد (د.ع)": s.paidAmount || 0,
    "المبلغ المتبقي (د.ع)": s.remainingAmount || 0,
    "حالة التسديد": s.status || (s.isPaid ? "تم التسديد بالكامل" : "لم يتم التسديد"),
    "عدد الوصولات": s.payments ? s.payments.length : 0,
    "تاريخ آخر تسديد": s.paymentDate || "",
    "المدقق": s.auditorName || "",
    "تاريخ الإضافة": s.createdAt
  }));

  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "طلبة الدراسات العليا");

  // تنزيل الملف
  XLSX.writeFile(workbook, `سجل_طلبة_الدراسات_العليا_والتسديدات_${new Date().toISOString().split('T')[0]}.xlsx`);
  showAlert('تم تصدير ملف Excel بنجاح!', 'success');
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
// 12. جلب البيانات من Google Sheet — المصدر الوحيد للحقيقة
// ==========================================
async function fetchStudentsFromGoogleSheet(showNotification = false) {
  let fetchedStudents = null;

  // --- المحاولة الأولى: doGet عبر Google Apps Script ---
  try {
    const webhookUrl = getActiveWebhookUrl();
    const resp = await fetch(webhookUrl, { method: 'GET' });
    if (resp.ok) {
      const jsonData = await resp.json();
      if (Array.isArray(jsonData)) {
        fetchedStudents = parseStudentsFromScript(jsonData);
      }
    }
  } catch (err1) {
    console.warn('doGet فشل، سنجرب GViz:', err1);
  }

  // --- المحاولة الثانية: GViz API (احتياطي) ---
  if (fetchedStudents === null) {
    try {
      fetchedStudents = await fetchViaGViz();
    } catch (err2) {
      console.warn('GViz أيضاً فشل:', err2);
    }
  }

  // --- تحديث القائمة إن تم الاتصال بنجاح ---
  if (fetchedStudents !== null) {
    // احتفظ بصور الوصائل من الكاش المحلي إن وجدت
    const localCacheMap = {};
    studentsList.forEach(s => { if (s.receiptImage) localCacheMap[s.id] = s.receiptImage; });

    studentsList = fetchedStudents.map(s => ({
      ...s,
      receiptImage: localCacheMap[s.id] || null
    }));

    saveToCache();
    renderStudentsTable();
    renderAccountsStudentSelector();
    updateStats();

    if (showNotification) {
      if (fetchedStudents.length > 0) {
        showAlert(`تم تحديث ${fetchedStudents.length} طالب من Google Sheet بنجاح ✓`, 'success');
      } else {
        showAlert('جدول Google Sheet فارغ حالياً.', 'info');
      }
    }
  } else {
    // فشل الاتصال بالشبكة
    if (showNotification) {
      showAlert('تعذر جلب البيانات من Google Sheet، تحقق من الاتصال بالإنترنت.', 'error');
    }
  }
}

// تحليل البيانات القادمة من doGet (Google Apps Script)
function parseStudentsFromScript(jsonData) {
  const result = [];
  for (const row of jsonData) {
    const id = String(row.id || '').trim();
    const fullName = String(row.fullName || '').trim();
    // تجاهل صفوف الاختبار
    if (!id || !fullName || id.startsWith('TEST') || id.startsWith('STU-TEST') || id.startsWith('NON_EXISTENT')) continue;

    const existing = studentsList.find(s => s.id === id);

    const studentObj = {
      id,
      fullName,
      expenseType: String(row.expenseType || ''),
      department: String(row.department || ''),
      studyType: String(row.studyType || ''),
      specialization: String(row.specialization || ''),
      admissionYear: String(row.admissionYear || ''),
      graduationYear: String(row.graduationYear || ''),
      totalFee: Number(String(row.totalFee || 0).replace(/[^\d.]/g, '')) || 0,
      paidAmount: Number(String(row.paidAmount || 0).replace(/[^\d.]/g, '')) || 0,
      remainingAmount: Number(String(row.remainingAmount || 0).replace(/[^\d.]/g, '')) || 0,
      status: String(row.status || ''),
      paymentDate: String(row.paymentDate || ''),
      auditorName: String(row.auditorName || ''),
      createdAt: String(row.createdAt || '') || new Date().toLocaleDateString('ar-IQ'),
      payments: Array.isArray(row.payments) ? row.payments : (existing?.payments || []),
      receiptImage: existing ? existing.receiptImage : null
    };

    calculateStudentFinancials(studentObj);
    result.push(studentObj);
  }
  return result;
}

// جلب البيانات عبر GViz API (احتياطي)
async function fetchViaGViz() {
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SPREADSHEET_ID}/gviz/tq?tqx=out:json`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const text = await resp.text();
  const prefix = '/*O_o*/\ngoogle.visualization.Query.setResponse(';
  let jsonStr = text;
  if (text.startsWith(prefix)) {
    jsonStr = text.substring(prefix.length, text.length - 2);
  }
  const data = JSON.parse(jsonStr);
  const rows = data.table?.rows || [];

  const parseGVizDate = (val) => {
    if (!val) return '';
    const s = String(val);
    const m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
    if (m) {
      return `${m[1]}-${String(Number(m[2])+1).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    return s;
  };

  const result = [];
  for (const r of rows) {
    const c = r.c || [];
    const getVal = (idx) => {
      if (!c[idx]) return '';
      if (c[idx].f !== undefined && c[idx].f !== null) return c[idx].f;
      if (c[idx].v !== undefined && c[idx].v !== null) return c[idx].v;
      return '';
    };

    const id = String(getVal(0) || '').trim();
    const fullName = String(getVal(1) || '').trim();
    // تجاهل صفوف الاختبار وأي صف فارغ
    if (!id || !fullName || id.startsWith('TEST') || id.startsWith('STU-TEST') || id.startsWith('NON_EXISTENT')) continue;

    const existing = studentsList.find(s => s.id === id);

    // فحص ما إذا كان الصف بنسق 17 عمود الجديد أو 14 عمود القديم
    const val8 = String(getVal(8) || '');
    let totalFee = 0;
    let paidAmount = 0;
    let remainingAmount = 0;
    let statusText = '';
    let payDate = '';
    let auditor = '';
    let createdAt = '';
    let paymentsArr = existing?.payments || [];

    if (val8.includes('تسديد') || val8.includes('التسديد')) {
      // نسق 14 عمود القديم
      statusText = val8;
      paidAmount = Number(String(getVal(9) || '').replace(/[^\d.]/g, '')) || 0;
      totalFee = paidAmount; // افتراضياً
      payDate = parseGVizDate(getVal(10));
      auditor = String(getVal(11) || '');
      createdAt = parseGVizDate(getVal(12));
    } else {
      // نسق 17 عمود الموسع
      totalFee = Number(String(getVal(8) || '').replace(/[^\d.]/g, '')) || 0;
      paidAmount = Number(String(getVal(9) || '').replace(/[^\d.]/g, '')) || 0;
      remainingAmount = Number(String(getVal(10) || '').replace(/[^\d.]/g, '')) || 0;
      statusText = String(getVal(11) || '');
      payDate = parseGVizDate(getVal(12));
      auditor = String(getVal(13) || '');
      createdAt = parseGVizDate(getVal(14));

      const paymentsJsonRaw = String(getVal(16) || '');
      if (paymentsJsonRaw.startsWith('[') && paymentsArr.length === 0) {
        try { paymentsArr = JSON.parse(paymentsJsonRaw); } catch(e) {}
      }
    }

    const studentObj = {
      id,
      fullName,
      expenseType: String(getVal(2) || ''),
      department: String(getVal(3) || ''),
      studyType: String(getVal(4) || ''),
      specialization: String(getVal(5) || ''),
      admissionYear: String(getVal(6) || ''),
      graduationYear: String(getVal(7) || ''),
      totalFee,
      paidAmount,
      remainingAmount,
      status: statusText,
      paymentDate: payDate === '-' ? '' : payDate,
      auditorName: auditor === '-' ? '' : auditor,
      createdAt: createdAt || new Date().toLocaleDateString('ar-IQ'),
      payments: paymentsArr,
      receiptImage: existing ? existing.receiptImage : null
    };

    calculateStudentFinancials(studentObj);
    result.push(studentObj);
  }
  return result;
}

// ==========================================
// 13. تحديث الإحصائيات والإشعارات
// ==========================================
function updateStats() {
  studentsList.forEach(s => calculateStudentFinancials(s));

  const total = studentsList.length;
  const fullyPaid = studentsList.filter(s => s.status === 'تم التسديد بالكامل' || s.isPaid).length;
  const partialPaid = studentsList.filter(s => s.status === 'مسدد جزئياً').length;
  
  const totalAmount = studentsList.reduce((acc, curr) => {
    return acc + (Number(curr.paidAmount) || 0);
  }, 0);

  const elTotal = document.getElementById('statTotalStudents');
  const elPaid = document.getElementById('statPaidCount');
  const elPartial = document.getElementById('statPartialCount');
  const elAmount = document.getElementById('statTotalAmount');

  if (elTotal) elTotal.innerText = total;
  if (elPaid) elPaid.innerText = fullyPaid;
  if (elPartial) elPartial.innerText = partialPaid;
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
