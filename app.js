'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCAmMVLdSUBe4cIu3nFOI7-DpsK9j_33RZ8edHilBnqyYiknlo7k7fWIc46AA5ASOd/exec';

const CREDENTIALS = {
  postgrad: { password: '123', name: 'قسم الدراسات العليا' },
  accounts: { password: '123', name: 'قسم الحسابات' }
};

const DEFAULT_PRIVATE_FEE = 3750000;
const RECEIPTS_KEY = 'receipts_v3';
const SYNC_DELAY_MS = 2000;

// ============================================================
// STATE
// ============================================================
let students = [];
let currentUser = null;
let selectedStudentId = null;
let pendingReceiptBase64 = null;
let isSyncing = false;

// ============================================================
// UTILITIES
// ============================================================
function $(id) { return document.getElementById(id); }

function fmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-IQ') + ' د.ع';
}

function genId() {
  return 'STU-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
}

function genPayId() {
  return 'PAY-' + Date.now() + '-' + Math.floor(Math.random() * 9999);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
let toastTimer = null;
function showToast(msg, type = 'info') {
  const el = $('toast');
  if (!el) return;
  const colors = {
    success: 'bg-teal-600',
    error:   'bg-red-600',
    info:    'bg-blue-600',
    warning: 'bg-yellow-500'
  };
  el.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-white font-bold shadow-lg transition-all duration-300 ${colors[type] || colors.info}`;
  el.textContent = msg;
  el.classList.remove('opacity-0', 'pointer-events-none');
  el.classList.add('opacity-100');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('opacity-0', 'pointer-events-none');
    el.classList.remove('opacity-100');
  }, 3000);
}

// ============================================================
// RECEIPT IMAGE STORAGE (localStorage)
// ============================================================
function loadReceiptsCache() {
  try {
    return JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '{}');
  } catch { return {}; }
}

function saveReceiptsCache(cache) {
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Receipt cache save failed (quota?):', e);
  }
}

function storeReceiptImage(studentId, paymentId, base64) {
  if (!base64) return;
  const cache = loadReceiptsCache();
  if (!cache[studentId]) cache[studentId] = {};
  cache[studentId][paymentId] = base64;
  saveReceiptsCache(cache);
}

function removeReceiptImage(studentId, paymentId) {
  const cache = loadReceiptsCache();
  if (cache[studentId]) {
    delete cache[studentId][paymentId];
    if (Object.keys(cache[studentId]).length === 0) delete cache[studentId];
  }
  saveReceiptsCache(cache);
}

function removeAllStudentReceipts(studentId) {
  const cache = loadReceiptsCache();
  delete cache[studentId];
  saveReceiptsCache(cache);
}

function mergeReceiptsIntoStudents(studentsArr) {
  const cache = loadReceiptsCache();
  return studentsArr.map(s => {
    const studentCache = cache[s.id] || {};
    return {
      ...s,
      payments: (s.payments || []).map(p => ({
        ...p,
        receiptImage: studentCache[p.id] || null
      }))
    };
  });
}

// ============================================================
// FINANCIAL CALCULATIONS
// ============================================================
function computeFinancials(student) {
  const totalFee   = Number(student.totalFee) || 0;
  const payments   = student.payments || [];
  const paidAmount = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remaining  = Math.max(0, totalFee - paidAmount);
  const percent    = totalFee > 0 ? Math.min(100, Math.round((paidAmount / totalFee) * 100)) : 100;
  const isPaid     = totalFee === 0 || paidAmount >= totalFee;

  let status;
  if (totalFee === 0) {
    status = 'معفى / نفقة عامة';
  } else if (paidAmount === 0) {
    status = 'لم يتم التسديد';
  } else if (paidAmount >= totalFee) {
    status = 'تم التسديد بالكامل';
  } else {
    status = `مسدد جزئياً (${percent}%)`;
  }

  return { totalFee, paidAmount, remainingAmount: remaining, percent, status, isPaid };
}

function statusBadgeClass(status) {
  if (!status) return 'bg-gray-100 text-gray-600';
  if (status.includes('بالكامل') || status.includes('معفى')) return 'bg-green-100 text-green-700';
  if (status.includes('جزئياً')) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

// ============================================================
// GOOGLE SHEETS SERVICE
// ============================================================
async function loadStudents() {
  setSyncState(true);
  try {
    const res = await fetch(SCRIPT_URL, { method: 'GET' });
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('Invalid response');

    // Normalize numeric fields from sheet
    const normalized = raw.map(s => ({
      ...s,
      totalFee:  Number(s.totalFee)  || 0,
      paidAmount:Number(s.paidAmount)|| 0,
      remainingAmount: Number(s.remainingAmount) || 0,
      payments: (s.payments || []).map(p => ({
        ...p,
        amount: Number(p.amount) || 0
      }))
    }));

    students = mergeReceiptsIntoStudents(normalized);
    renderCurrentView();
    renderStats();
  } catch (err) {
    console.error('loadStudents error:', err);
    showToast('خطأ في تحميل البيانات: ' + err.message, 'error');
  } finally {
    setSyncState(false);
  }
}

async function saveStudent(student) {
  // Optimistic update
  const idx = students.findIndex(s => s.id === student.id);
  if (idx >= 0) {
    students[idx] = { ...student };
  } else {
    students.push({ ...student });
  }
  renderCurrentView();
  renderStats();

  // Store receipt images in localStorage (separated from sheet data)
  const payments = student.payments || [];
  payments.forEach(p => {
    if (p.receiptImage) {
      storeReceiptImage(student.id, p.id, p.receiptImage);
    }
  });

  // Send to sheet (no-cors for POST — we can't read the response, that's ok)
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode:   'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', student })
    });
  } catch (err) {
    console.warn('saveStudent POST error (no-cors expected):', err);
  }

  // Confirm from sheet after delay
  setTimeout(loadStudents, SYNC_DELAY_MS);
}

async function deleteStudent(id) {
  // Optimistic: remove from local state immediately
  students = students.filter(s => s.id !== id);
  removeAllStudentReceipts(id);
  if (selectedStudentId === id) selectedStudentId = null;
  renderCurrentView();
  renderStats();

  // Use GET-based delete (readable response, no CORS issue)
  try {
    const url = `${SCRIPT_URL}?action=delete&id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.success) {
      showToast('تم حذف الطالب بنجاح', 'success');
    } else {
      showToast('تحذير: ' + (data.error || data.message || 'مشكلة في الحذف'), 'warning');
    }
  } catch (err) {
    console.warn('deleteStudent error:', err);
    showToast('خطأ في الاتصال بالخادم', 'error');
  }

  // Sync to confirm
  setTimeout(loadStudents, SYNC_DELAY_MS);
}

async function addPaymentToStudent(studentId, payment) {
  const student = students.find(s => s.id === studentId);
  if (!student) { showToast('الطالب غير موجود', 'error'); return; }

  const newPayment = {
    id:           genPayId(),
    amount:       Number(payment.amount) || 0,
    date:         payment.date || todayISO(),
    auditor:      payment.auditor || '',
    receiptImage: payment.receiptImage || null
  };

  const updated = { ...student, payments: [...(student.payments || []), newPayment] };
  await saveStudent(updated);
  showToast('تمت إضافة الدفعة بنجاح', 'success');
}

async function removePaymentFromStudent(studentId, paymentId) {
  const student = students.find(s => s.id === studentId);
  if (!student) { showToast('الطالب غير موجود', 'error'); return; }

  removeReceiptImage(studentId, paymentId);
  const updated = {
    ...student,
    payments: (student.payments || []).filter(p => p.id !== paymentId)
  };
  await saveStudent(updated);
  showToast('تم حذف الدفعة بنجاح', 'success');
}

// ============================================================
// SYNC STATE UI
// ============================================================
function setSyncState(syncing) {
  isSyncing = syncing;
  const btn = $('syncBtn');
  if (!btn) return;
  btn.classList.toggle('animate-spin', syncing);
}

// ============================================================
// AUTH
// ============================================================
function setupLoginScreen() {
  const roleButtons = document.querySelectorAll('.role-btn');
  let selectedRole = null;

  roleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roleButtons.forEach(b => b.classList.remove('ring-2', 'ring-teal-500', 'bg-teal-50'));
      btn.classList.add('ring-2', 'ring-teal-500', 'bg-teal-50');
      selectedRole = btn.dataset.role;
    });
  });

  $('loginBtn').addEventListener('click', () => {
    const password = $('passwordInput').value;
    if (!selectedRole) { showToast('اختر الدور أولاً', 'warning'); return; }
    const cred = CREDENTIALS[selectedRole];
    if (!cred || password !== cred.password) {
      showToast('كلمة المرور غير صحيحة', 'error'); return;
    }
    currentUser = { role: selectedRole, name: cred.name };
    $('loginScreen').classList.add('hidden');
    $('appShell').classList.remove('hidden');
    $('userBadge').textContent = cred.name;
    renderHeader();
    loadStudents().then(() => {
      if (selectedRole === 'postgrad') showPostgradView();
      else showAccountsView();
    });
  });

  $('passwordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('loginBtn').click();
  });
}

function logout() {
  currentUser = null;
  selectedStudentId = null;
  students = [];
  $('passwordInput').value = '';
  document.querySelectorAll('.role-btn').forEach(b =>
    b.classList.remove('ring-2', 'ring-teal-500', 'bg-teal-50')
  );
  $('loginScreen').classList.remove('hidden');
  $('appShell').classList.add('hidden');
}

function renderHeader() {
  $('syncBtn').onclick = () => loadStudents();
  $('logoutBtn').onclick = logout;
}

// ============================================================
// STATS BAR
// ============================================================
function renderStats() {
  const total    = students.length;
  let fullPaid   = 0;
  let partPaid   = 0;
  let totalColl  = 0;

  students.forEach(s => {
    const f = computeFinancials(s);
    totalColl += f.paidAmount;
    if (f.totalFee === 0) { fullPaid++; return; } // معفى counts as paid
    if (f.isPaid)        fullPaid++;
    else if (f.paidAmount > 0) partPaid++;
  });

  const el = $('statsBar');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card">
      <div class="text-3xl font-bold text-teal-700">${total}</div>
      <div class="text-sm text-gray-500 mt-1">إجمالي الطلبة</div>
    </div>
    <div class="stat-card">
      <div class="text-3xl font-bold text-green-600">${fullPaid}</div>
      <div class="text-sm text-gray-500 mt-1">مسدد كلياً</div>
    </div>
    <div class="stat-card">
      <div class="text-3xl font-bold text-yellow-600">${partPaid}</div>
      <div class="text-sm text-gray-500 mt-1">مسدد جزئياً</div>
    </div>
    <div class="stat-card">
      <div class="text-3xl font-bold text-blue-700">${fmt(totalColl)}</div>
      <div class="text-sm text-gray-500 mt-1">إجمالي المستحصل</div>
    </div>
  `;
}

// ============================================================
// CURRENT VIEW ROUTER
// ============================================================
function renderCurrentView() {
  if (!currentUser) return;
  if (currentUser.role === 'postgrad') renderPostgradTable();
  else renderAccountsView();
}

// ============================================================
// POSTGRAD VIEW
// ============================================================
function showPostgradView() {
  $('postgradView').classList.remove('hidden');
  $('accountsView').classList.add('hidden');
  renderPostgradTable();
}

function getPostgradFilters() {
  const search  = ($('searchInput')  && $('searchInput').value.trim().toLowerCase())  || '';
  const status  = ($('statusFilter') && $('statusFilter').value)  || '';
  const expense = ($('expenseFilter')&& $('expenseFilter').value) || '';
  return { search, status, expense };
}

function applyPostgradFilters(list) {
  const { search, status, expense } = getPostgradFilters();
  return list.filter(s => {
    const f = computeFinancials(s);
    if (search  && !s.fullName.toLowerCase().includes(search) &&
                   !s.department.toLowerCase().includes(search)) return false;
    if (expense && s.expenseType !== expense) return false;
    if (status) {
      if (status === 'paid'    && !f.isPaid)             return false;
      if (status === 'partial' && (f.paidAmount === 0 || f.isPaid)) return false;
      if (status === 'unpaid'  && f.paidAmount !== 0)    return false;
      if (status === 'exempt'  && f.totalFee  !== 0)     return false;
    }
    return true;
  });
}

function renderPostgradTable() {
  const tbody = $('studentsTableBody');
  if (!tbody) return;

  const filtered = applyPostgradFilters(students);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-10 text-center text-gray-400 text-lg">لا توجد بيانات</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((s, i) => {
    const f = computeFinancials(s);
    const badgeClass = statusBadgeClass(f.status);
    return `
      <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
        <td class="py-3 px-4 text-gray-500 text-sm">${i + 1}</td>
        <td class="py-3 px-4 font-semibold text-gray-800">${escHtml(s.fullName)}</td>
        <td class="py-3 px-4 text-gray-600">${escHtml(s.department)}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-1 rounded-full text-xs ${s.expenseType === 'نفقة خاصة' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}">
            ${escHtml(s.expenseType)}
          </span>
        </td>
        <td class="py-3 px-4 text-gray-600">${escHtml(s.studyType)}</td>
        <td class="py-3 px-4 text-gray-700 font-mono">${fmt(f.totalFee)}</td>
        <td class="py-3 px-4">
          <span class="px-3 py-1 rounded-full text-xs font-semibold ${badgeClass}">${escHtml(f.status)}</span>
        </td>
        <td class="py-3 px-4">
          <div class="flex gap-2 justify-center">
            <button onclick="exportStudentPDF('${escHtml(s.id)}')"
              class="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition" title="تحميل PDF">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              </svg>
            </button>
            <button onclick="confirmDeleteStudent('${escHtml(s.id)}', '${escHtml(s.fullName)}')"
              class="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition" title="حذف">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function setupPostgradFilters() {
  ['searchInput', 'statusFilter', 'expenseFilter'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderPostgradTable);
  });
}

// ---- Add Student Modal ----
function openAddStudentModal() {
  $('addStudentModal').classList.remove('hidden');
  $('addStudentForm').reset();
  $('totalFeeField').value = DEFAULT_PRIVATE_FEE;
  updateFeeFieldVisibility();
}

function closeAddStudentModal() {
  $('addStudentModal').classList.add('hidden');
}

function updateFeeFieldVisibility() {
  const expenseType = $('expenseTypeSelect').value;
  const feeRow = $('feeRow');
  if (expenseType === 'نفقة خاصة') {
    feeRow.classList.remove('hidden');
    $('totalFeeField').value = $('totalFeeField').value || DEFAULT_PRIVATE_FEE;
  } else {
    feeRow.classList.add('hidden');
    $('totalFeeField').value = 0;
  }
}

async function submitAddStudentForm(e) {
  e.preventDefault();
  const expenseType = $('expenseTypeSelect').value;
  let   totalFee    = expenseType === 'نفقة خاصة'
                      ? (Number($('totalFeeField').value) || DEFAULT_PRIVATE_FEE)
                      : 0;

  const student = {
    id:             genId(),
    fullName:       $('fullNameInput').value.trim(),
    expenseType,
    department:     $('departmentInput').value.trim(),
    studyType:      $('studyTypeSelect').value,
    specialization: $('specializationInput').value.trim(),
    admissionYear:  $('admissionYearInput').value.trim(),
    graduationYear: $('graduationYearInput').value.trim(),
    totalFee,
    payments:       [],
    createdAt:      new Date().toISOString()
  };

  if (!student.fullName) { showToast('أدخل اسم الطالب', 'warning'); return; }
  if (!student.department) { showToast('أدخل القسم', 'warning'); return; }

  closeAddStudentModal();
  await saveStudent(student);
  showToast('تمت إضافة الطالب بنجاح', 'success');
}

function confirmDeleteStudent(id, name) {
  if (confirm(`هل أنت متأكد من حذف الطالب: ${name}؟`)) {
    deleteStudent(id);
  }
}

// ============================================================
// ACCOUNTS VIEW
// ============================================================
function showAccountsView() {
  $('accountsView').classList.remove('hidden');
  $('postgradView').classList.add('hidden');
  renderAccountsView();
}

function renderAccountsView() {
  renderStudentList();
  if (selectedStudentId) renderStudentDetail(selectedStudentId);
  else clearStudentDetail();
}

function renderStudentList() {
  const container = $('studentList');
  if (!container) return;
  if (students.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-gray-400">لا توجد بيانات</div>`;
    return;
  }
  container.innerHTML = students.map(s => {
    const f = computeFinancials(s);
    const isSelected = s.id === selectedStudentId;
    const badgeClass = statusBadgeClass(f.status);
    return `
      <div onclick="selectStudent('${escHtml(s.id)}')"
        class="student-list-item px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-teal-50 transition-colors
               ${isSelected ? 'bg-teal-50 border-r-4 border-r-teal-500' : ''}">
        <div class="font-semibold text-gray-800 text-sm">${escHtml(s.fullName)}</div>
        <div class="mt-1">
          <span class="text-xs px-2 py-0.5 rounded-full ${badgeClass}">${escHtml(f.status)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectStudent(id) {
  selectedStudentId = id;
  renderStudentList();
  renderStudentDetail(id);
}

function clearStudentDetail() {
  const panel = $('studentDetailPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="flex items-center justify-center h-full text-gray-400 text-lg">
      <div class="text-center">
        <div class="text-5xl mb-4">👈</div>
        <div>اختر طالباً من القائمة لعرض تفاصيله</div>
      </div>
    </div>
  `;
}

function renderStudentDetail(id) {
  const student = students.find(s => s.id === id);
  const panel   = $('studentDetailPanel');
  if (!panel) return;
  if (!student) { clearStudentDetail(); return; }

  const f = computeFinancials(student);
  const badgeClass = statusBadgeClass(f.status);
  const payments = student.payments || [];

  panel.innerHTML = `
    <!-- Student Info Card -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
      <h3 class="text-lg font-bold text-teal-700 mb-3 flex items-center gap-2">
        <span>👤</span> بيانات الطالب
      </h3>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div><span class="text-gray-500">الاسم: </span><strong>${escHtml(student.fullName)}</strong></div>
        <div><span class="text-gray-500">القسم: </span><strong>${escHtml(student.department)}</strong></div>
        <div><span class="text-gray-500">النفقة: </span><strong>${escHtml(student.expenseType)}</strong></div>
        <div><span class="text-gray-500">نوع الدراسة: </span><strong>${escHtml(student.studyType)}</strong></div>
        <div><span class="text-gray-500">التخصص: </span><strong>${escHtml(student.specialization)}</strong></div>
        <div><span class="text-gray-500">سنة القبول: </span><strong>${escHtml(student.admissionYear)}</strong></div>
      </div>
    </div>

    <!-- Financial Summary -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
      <h3 class="text-lg font-bold text-teal-700 mb-4 flex items-center gap-2">
        <span>💰</span> الملخص المالي
      </h3>
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div class="text-center bg-gray-50 rounded-xl p-3">
          <div class="text-xs text-gray-500 mb-1">المبلغ المقرر</div>
          <div class="font-bold text-gray-800">${fmt(f.totalFee)}</div>
        </div>
        <div class="text-center bg-green-50 rounded-xl p-3">
          <div class="text-xs text-gray-500 mb-1">إجمالي المسدد</div>
          <div class="font-bold text-green-700">${fmt(f.paidAmount)}</div>
        </div>
        <div class="text-center bg-red-50 rounded-xl p-3">
          <div class="text-xs text-gray-500 mb-1">المتبقي</div>
          <div class="font-bold text-red-600">${fmt(f.remainingAmount)}</div>
        </div>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden">
        <div class="h-3 rounded-full transition-all duration-500
          ${f.isPaid ? 'bg-green-500' : 'bg-teal-500'}"
          style="width: ${f.percent}%"></div>
      </div>
      <div class="text-center">
        <span class="px-4 py-1.5 rounded-full text-sm font-bold ${badgeClass}">${escHtml(f.status)}</span>
      </div>
    </div>

    <!-- Add Payment Form -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
      <h3 class="text-lg font-bold text-teal-700 mb-4 flex items-center gap-2">
        <span>➕</span> إضافة دفعة
      </h3>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">المبلغ (د.ع)</label>
          <input id="payAmountInput" type="number" min="0"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            placeholder="أدخل المبلغ">
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">التاريخ</label>
          <input id="payDateInput" type="date" value="${todayISO()}"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
        </div>
      </div>
      <div class="mb-3">
        <label class="block text-xs text-gray-500 mb-1">المدقق</label>
        <input id="payAuditorInput" type="text"
          class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          placeholder="اسم المدقق">
      </div>
      <div class="mb-4">
        <label class="block text-xs text-gray-500 mb-1">صورة الوصل (اختياري)</label>
        <input id="payReceiptInput" type="file" accept="image/*"
          class="w-full text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-teal-50 file:text-teal-700"
          onchange="handleReceiptFile(this)">
        <div id="receiptPreview" class="mt-2 hidden">
          <img id="receiptPreviewImg" class="max-h-24 rounded-lg border" src="" alt="صورة الوصل">
        </div>
      </div>
      <button onclick="submitPayment('${escHtml(student.id)}')"
        class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-xl transition-colors">
        حفظ الدفعة
      </button>
    </div>

    <!-- Payments History -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 class="text-lg font-bold text-teal-700 mb-4 flex items-center gap-2">
        <span>📋</span> سجل الدفعات (${payments.length})
      </h3>
      ${payments.length === 0
        ? '<div class="text-center text-gray-400 py-6">لا توجد دفعات مسجلة</div>'
        : `<div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 text-gray-500">
                  <th class="py-2 px-3 text-right">#</th>
                  <th class="py-2 px-3 text-right">التاريخ</th>
                  <th class="py-2 px-3 text-right">المبلغ</th>
                  <th class="py-2 px-3 text-right">المدقق</th>
                  <th class="py-2 px-3 text-center">الوصل</th>
                  <th class="py-2 px-3 text-center">حذف</th>
                </tr>
              </thead>
              <tbody>
                ${payments.map((p, i) => `
                  <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="py-2 px-3 text-gray-400">${i + 1}</td>
                    <td class="py-2 px-3">${escHtml(p.date)}</td>
                    <td class="py-2 px-3 font-semibold text-green-700">${fmt(p.amount)}</td>
                    <td class="py-2 px-3">${escHtml(p.auditor)}</td>
                    <td class="py-2 px-3 text-center">
                      ${p.receiptImage
                        ? `<button onclick="viewReceipt('${escHtml(p.id)}')"
                             class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-100">
                             عرض
                           </button>`
                        : '<span class="text-gray-300 text-xs">—</span>'
                      }
                    </td>
                    <td class="py-2 px-3 text-center">
                      <button onclick="confirmDeletePayment('${escHtml(student.id)}', '${escHtml(p.id)}')"
                        class="text-red-500 hover:text-red-700 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`
      }
    </div>
  `;

  // Restore pendingReceiptBase64 if any
  pendingReceiptBase64 = null;
}

function handleReceiptFile(input) {
  const file = input.files[0];
  if (!file) { pendingReceiptBase64 = null; return; }
  const reader = new FileReader();
  reader.onload = e => {
    pendingReceiptBase64 = e.target.result;
    const preview = $('receiptPreview');
    const img     = $('receiptPreviewImg');
    if (preview && img) {
      img.src = pendingReceiptBase64;
      preview.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
}

async function submitPayment(studentId) {
  const amountEl  = $('payAmountInput');
  const dateEl    = $('payDateInput');
  const auditorEl = $('payAuditorInput');
  if (!amountEl || !dateEl || !auditorEl) return;

  const amount  = Number(amountEl.value);
  const date    = dateEl.value || todayISO();
  const auditor = auditorEl.value.trim();

  if (!amount || amount <= 0) { showToast('أدخل مبلغاً صحيحاً', 'warning'); return; }
  if (!auditor)               { showToast('أدخل اسم المدقق', 'warning');    return; }

  await addPaymentToStudent(studentId, {
    amount,
    date,
    auditor,
    receiptImage: pendingReceiptBase64 || null
  });
  pendingReceiptBase64 = null;
}

function confirmDeletePayment(studentId, paymentId) {
  if (confirm('هل أنت متأكد من حذف هذه الدفعة؟')) {
    removePaymentFromStudent(studentId, paymentId);
  }
}

function viewReceipt(paymentId) {
  const student = students.find(s => s.id === selectedStudentId);
  if (!student) return;
  const payment = (student.payments || []).find(p => p.id === paymentId);
  if (!payment || !payment.receiptImage) { showToast('لا توجد صورة', 'warning'); return; }
  const win = window.open('');
  win.document.write(`<html><body style="margin:0;background:#000;">
    <img src="${payment.receiptImage}" style="max-width:100%;display:block;margin:auto;">
  </body></html>`);
}

// ============================================================
// EXPORT — Individual Student PDF
// ============================================================
function exportStudentPDF(id) {
  const student = students.find(s => s.id === id);
  if (!student) { showToast('الطالب غير موجود', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const f   = computeFinancials(student);

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Student Financial Voucher', 105, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('College of Urban Planning - Graduate Studies', 105, 26, { align: 'center' });

  doc.setFontSize(10);
  doc.setDrawColor(20, 155, 140);
  doc.line(14, 30, 196, 30);

  // Student info table
  doc.autoTable({
    startY: 34,
    theme: 'grid',
    head: [['Field', 'Value']],
    body: [
      ['ID',              student.id],
      ['Full Name',       student.fullName],
      ['Department',      student.department],
      ['Expense Type',    student.expenseType],
      ['Study Type',      student.studyType],
      ['Specialization',  student.specialization],
      ['Admission Year',  student.admissionYear],
      ['Graduation Year', student.graduationYear],
      ['Total Fee',       fmt(f.totalFee)],
      ['Paid Amount',     fmt(f.paidAmount)],
      ['Remaining',       fmt(f.remainingAmount)],
      ['Status',          f.status]
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [20, 155, 140] }
  });

  // Payments
  const payments = student.payments || [];
  if (payments.length > 0) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      theme: 'striped',
      head: [['#', 'Date', 'Amount', 'Auditor']],
      body: payments.map((p, i) => [i + 1, p.date, fmt(p.amount), p.auditor]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [20, 155, 140] }
    });
  }

  doc.save(`voucher_${student.id}.pdf`);
  showToast('تم تحميل PDF بنجاح', 'success');
}

// ============================================================
// EXPORT — All Students Excel
// ============================================================
function exportAllExcel() {
  if (!window.XLSX) { showToast('مكتبة Excel غير محملة', 'error'); return; }
  if (students.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

  const rows = students.map((s, i) => {
    const f = computeFinancials(s);
    return {
      '#':             i + 1,
      'معرف الطالب':   s.id,
      'الاسم':         s.fullName,
      'القسم':         s.department,
      'النفقة':        s.expenseType,
      'نوع الدراسة':   s.studyType,
      'التخصص':        s.specialization,
      'سنة القبول':    s.admissionYear,
      'سنة التخرج':    s.graduationYear,
      'المبلغ المقرر': f.totalFee,
      'إجمالي المسدد': f.paidAmount,
      'المتبقي':       f.remainingAmount,
      'الحالة':        f.status,
      'عدد الدفعات':   (s.payments || []).length
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الطلبة');
  XLSX.writeFile(wb, 'students_report.xlsx');
  showToast('تم تصدير Excel بنجاح', 'success');
}

// ============================================================
// INIT
// ============================================================
function init() {
  setupLoginScreen();
  setupPostgradFilters();

  // Add student form
  const form = $('addStudentForm');
  if (form) form.addEventListener('submit', submitAddStudentForm);

  const expSelect = $('expenseTypeSelect');
  if (expSelect) expSelect.addEventListener('change', updateFeeFieldVisibility);

  // FAB
  const fab = $('fabAddStudent');
  if (fab) fab.addEventListener('click', openAddStudentModal);

  // Modal close
  const closeModalBtn = $('closeModalBtn');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeAddStudentModal);

  const modalOverlay = $('modalOverlay');
  if (modalOverlay) modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeAddStudentModal();
  });

  // Export buttons
  const excelBtn = $('exportExcelBtn');
  if (excelBtn) excelBtn.addEventListener('click', exportAllExcel);
}

document.addEventListener('DOMContentLoaded', init);
