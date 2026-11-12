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
let activeReceiptPayment = null;
let activeReceiptStudent = null;

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
      payments: (s.payments || []).map(p => {
        const cachedImg = studentCache[p.id];
        const serverImg = p.receiptImage;
        const finalImg  = cachedImg || serverImg || null;
        if (serverImg && !cachedImg) {
          storeReceiptImage(s.id, p.id, serverImg);
        }
        return {
          ...p,
          receiptImage: finalImg,
          hasReceipt: Boolean(finalImg || p.hasReceipt || p.receiptUrl)
        };
      })
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
      totalFee:        Number(s.totalFee)  || 0,
      paidAmount:      Number(s.paidAmount)|| 0,
      remainingAmount: Number(s.remainingAmount) || 0,
      discountPercent: Number(s.discountPercent) || 0,
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
    const paymentsClean = (student.payments || []).map(p => ({
      id:             p.id,
      amount:         Number(p.amount) || 0,
      date:           p.date || '',
      auditor:        p.auditor || '',
      receiptUrl:     p.receiptUrl || '',
      receiptViewUrl: p.receiptViewUrl || '',
      receiptImage:   p.receiptImage || null
    }));

    const payload = {
      action:          'save',
      // Flat fields (old Apps Script compatibility)
      id:              student.id,
      fullName:        student.fullName       || '',
      expenseType:     student.expenseType    || '',
      department:      student.department     || '',
      studyType:       student.studyType      || '',
      specialization:  student.specialization || '',
      admissionYear:   student.admissionYear  || '',
      graduationYear:  student.graduationYear || '',
      totalFee:        Number(student.totalFee) || 0,
      discountPercent: Number(student.discountPercent) || 0,
      createdAt:       student.createdAt      || new Date().toISOString(),
      payments:        paymentsClean,
      // Nested student object (new Apps Script compatibility)
      student: {
        id:              student.id,
        fullName:        student.fullName       || '',
        expenseType:     student.expenseType    || '',
        department:      student.department     || '',
        studyType:       student.studyType      || '',
        specialization:  student.specialization || '',
        admissionYear:   student.admissionYear  || '',
        graduationYear:  student.graduationYear || '',
        totalFee:        Number(student.totalFee) || 0,
        discountPercent: Number(student.discountPercent) || 0,
        createdAt:       student.createdAt      || new Date().toISOString(),
        payments:        paymentsClean
      }
    };

    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode:   'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(payload)
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
  const fab = $('fabAddStudent');
  if (fab) fab.classList.add('hidden');
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
  const fab = $('fabAddStudent');
  if (currentUser.role === 'postgrad') {
    if (fab) fab.classList.remove('hidden');
    renderPostgradTable();
  } else {
    if (fab) fab.classList.add('hidden');
    renderAccountsView();
  }
}

// ============================================================
// POSTGRAD VIEW
// ============================================================
function showPostgradView() {
  $('postgradView').classList.remove('hidden');
  $('accountsView').classList.add('hidden');
  const fab = $('fabAddStudent');
  if (fab) fab.classList.remove('hidden');
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
  if (!currentUser || currentUser.role !== 'postgrad') {
    showToast('صلاحية إضافة طالب خاصة بقسم الدراسات العليا فقط', 'warning');
    return;
  }
  $('addStudentModal').classList.remove('hidden');
  $('addStudentForm').reset();
  $('totalFeeField').value = DEFAULT_PRIVATE_FEE;
  if ($('discountPercentInput')) $('discountPercentInput').value = '';
  updateFeeFieldVisibility();
}

function closeAddStudentModal() {
  $('addStudentModal').classList.add('hidden');
}

function handleDiscountChange() {
  const discountInput = $('discountPercentInput');
  const totalFeeInput = $('totalFeeField');
  const expenseType = $('expenseTypeSelect') ? $('expenseTypeSelect').value : 'نفقة خاصة';
  if (!discountInput || !totalFeeInput) return;

  if (expenseType === 'نفقة خاصة') {
    const val = discountInput.value.trim();
    if (val === '') {
      totalFeeInput.value = DEFAULT_PRIVATE_FEE;
    } else {
      const discount = Math.max(0, Math.min(100, Number(val) || 0));
      totalFeeInput.value = Math.round(DEFAULT_PRIVATE_FEE * (1 - discount / 100));
    }
  }
}

function updateFeeFieldVisibility() {
  const expenseType = $('expenseTypeSelect').value;
  const feeRow = $('feeRow');
  const discountRow = $('discountRow');
  if (expenseType === 'نفقة خاصة') {
    if (feeRow) feeRow.classList.remove('hidden');
    if (discountRow) discountRow.classList.remove('hidden');
    handleDiscountChange();
  } else {
    if (feeRow) feeRow.classList.add('hidden');
    if (discountRow) discountRow.classList.add('hidden');
    if ($('totalFeeField')) $('totalFeeField').value = 0;
    if ($('discountPercentInput')) $('discountPercentInput').value = '';
  }
}

async function submitAddStudentForm(e) {
  e.preventDefault();
  const expenseType = $('expenseTypeSelect').value;
  let   totalFee    = expenseType === 'نفقة خاصة'
                      ? (Number($('totalFeeField').value) || DEFAULT_PRIVATE_FEE)
                      : 0;
  const discountPercent = expenseType === 'نفقة خاصة'
                      ? (Number($('discountPercentInput')?.value) || 0)
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
    discountPercent,
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
  const fab = $('fabAddStudent');
  if (fab) fab.classList.add('hidden');
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

    <!-- Payment Details -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
      <h3 class="text-lg font-bold text-teal-700 mb-4 flex items-center gap-2">
        <span>💰</span> بيانات الدفع
      </h3>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div class="text-center bg-gray-50 rounded-xl p-3 border border-gray-100">
          <div class="text-xs text-gray-500 mb-1">المبلغ المقرر</div>
          <div class="font-bold text-gray-800">${fmt(f.totalFee)}</div>
        </div>
        <div class="text-center bg-purple-50 rounded-xl p-3 border border-purple-100">
          <div class="text-xs text-purple-700 font-semibold mb-1">نسبة التخفيض</div>
          <div class="font-bold text-purple-800 text-base">${Number(student.discountPercent || 0)}%</div>
        </div>
        <div class="text-center bg-green-50 rounded-xl p-3 border border-green-100">
          <div class="text-xs text-green-700 font-semibold mb-1">إجمالي المسدد</div>
          <div class="font-bold text-green-700">${fmt(f.paidAmount)}</div>
        </div>
        <div class="text-center bg-red-50 rounded-xl p-3 border border-red-100">
          <div class="text-xs text-red-700 font-semibold mb-1">المتبقي</div>
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
        <label class="block text-xs text-gray-500 mb-1">صورة الوصل</label>
        <input id="payReceiptInput" type="file" accept="image/*"
          class="w-full text-sm text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-teal-50 file:text-teal-700"
          onchange="handleReceiptFile(this)">
        <div id="receiptPreview" class="mt-2 hidden">
          <div class="flex items-center gap-3 p-2.5 bg-teal-50 border border-teal-200 rounded-xl">
            <img id="receiptPreviewImg" class="w-14 h-14 object-cover rounded-lg border border-teal-300" src="" alt="صورة الوصل">
            <div class="flex-1 text-xs">
              <div class="font-bold text-teal-800">✅ تم اختيار صورة الوصل بنجاح</div>
              <div class="text-teal-600">سيتم حفظ الصورة مع الدفعة في ملف الـ Sheet</div>
            </div>
            <button type="button" onclick="cancelReceiptUpload()" class="text-xs bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded-lg transition font-medium">إلغاء</button>
          </div>
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
                      ${(p.receiptImage || p.receiptUrl || p.receiptViewUrl)
                        ? `<button onclick="viewReceipt('${escHtml(p.id)}')"
                             class="text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg hover:bg-blue-100 inline-flex items-center gap-1 mx-auto font-medium transition">
                             <span>🖼️</span> عرض
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

function cancelReceiptUpload() {
  pendingReceiptBase64 = null;
  const input = $('payReceiptInput');
  if (input) input.value = '';
  const preview = $('receiptPreview');
  if (preview) preview.classList.add('hidden');
}

function handleReceiptFile(input) {
  const file = input.files[0];
  if (!file) { cancelReceiptUpload(); return; }

  const reader = new FileReader();
  reader.onload = e => {
    const rawData = e.target.result;
    const img = new Image();
    img.onload = () => {
      // Compress to max 800px width/height and quality 0.65
      // This produces ~25KB to 30KB, which saves easily in Google Sheets
      const maxDim = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      pendingReceiptBase64 = canvas.toDataURL('image/jpeg', 0.65);

      const preview = $('receiptPreview');
      const imgEl   = $('receiptPreviewImg');
      if (preview && imgEl) {
        imgEl.src = pendingReceiptBase64;
        preview.classList.remove('hidden');
      }
    };
    img.onerror = () => {
      pendingReceiptBase64 = rawData;
      const preview = $('receiptPreview');
      const imgEl   = $('receiptPreviewImg');
      if (preview && imgEl) {
        imgEl.src = pendingReceiptBase64;
        preview.classList.remove('hidden');
      }
    };
    img.src = rawData;
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
  cancelReceiptUpload();
}

function confirmDeletePayment(studentId, paymentId) {
  if (confirm('هل أنت متأكد من حذف هذه الدفعة؟')) {
    removePaymentFromStudent(studentId, paymentId);
  }
}

async function viewReceipt(paymentId) {
  const student = students.find(s => s.id === selectedStudentId);
  if (!student) return;
  const payment = (student.payments || []).find(p => p.id === paymentId);
  if (!payment) { showToast('الدفعة غير موجودة', 'warning'); return; }

  activeReceiptStudent = student;
  activeReceiptPayment = payment;

  // Retrieve base64 image if available
  let imgSrc = payment.receiptImage;
  if (!imgSrc) {
    const cache = loadReceiptsCache();
    imgSrc = (cache[student.id] && cache[student.id][paymentId]) || null;
  }

  const modal = $('receiptModal');
  const modalImg = $('receiptModalImg');
  const modalLoading = $('receiptModalLoading');
  const studentEl = $('receiptModalStudent');
  const amountEl = $('receiptModalAmount');
  const dateEl = $('receiptModalDate');
  const auditorEl = $('receiptModalAuditor');

  if (!modal) return;

  if (studentEl) studentEl.textContent = student.fullName || 'طالب';
  if (amountEl)  amountEl.textContent  = fmt(payment.amount);
  if (dateEl)    dateEl.textContent    = payment.date || '-';
  if (auditorEl) auditorEl.textContent = payment.auditor || '-';

  modal.classList.remove('hidden');

  if (imgSrc && String(imgSrc).startsWith('data:image')) {
    payment.receiptImage = imgSrc;
    if (modalLoading) modalLoading.classList.add('hidden');
    if (modalImg) {
      modalImg.src = imgSrc;
      modalImg.classList.remove('hidden');
    }
  } else {
    // Show spinner and fetch image from server
    if (modalImg) modalImg.classList.add('hidden');
    if (modalLoading) modalLoading.classList.remove('hidden');

    try {
      const res = await fetch(`${SCRIPT_URL}?action=get_receipt&id=${encodeURIComponent(paymentId)}`);
      const data = await res.json();
      if (data && data.receiptImage) {
        payment.receiptImage = data.receiptImage;
        storeReceiptImage(student.id, paymentId, data.receiptImage);
        if (modalImg) {
          modalImg.src = data.receiptImage;
          modalImg.classList.remove('hidden');
        }
        if (modalLoading) modalLoading.classList.add('hidden');
      } else if (payment.receiptUrl) {
        closeReceiptModal();
        window.open(payment.receiptUrl, '_blank');
      } else {
        if (modalLoading) modalLoading.classList.add('hidden');
        showToast('لم يتم العثور على صورة الوصل', 'warning');
      }
    } catch (err) {
      console.warn('Fetch receipt error:', err);
      if (modalLoading) modalLoading.classList.add('hidden');
      if (payment.receiptUrl) {
        closeReceiptModal();
        window.open(payment.receiptUrl, '_blank');
      } else {
        showToast('تعذر تحميل صورة الوصل', 'error');
      }
    }
  }
}

function closeReceiptModal() {
  const modal = $('receiptModal');
  if (modal) modal.classList.add('hidden');
  const modalImg = $('receiptModalImg');
  if (modalImg) modalImg.src = '';
  const modalLoading = $('receiptModalLoading');
  if (modalLoading) modalLoading.classList.add('hidden');
  activeReceiptPayment = null;
  activeReceiptStudent = null;
}

function printReceiptModal() {
  if (!activeReceiptStudent || !activeReceiptPayment) return;
  const modalImg = $('receiptModalImg');
  const imgSrc = modalImg ? modalImg.src : (activeReceiptPayment.receiptImage || '');
  if (!imgSrc || !imgSrc.startsWith('data:image')) {
    showToast('لا توجد صورة جاهزة للطباعة', 'warning');
    return;
  }

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>وصل تسديد — ${escHtml(activeReceiptStudent.fullName || '')}</title>
  <style>
    body { margin:0; padding:24px; font-family:system-ui,sans-serif; text-align:center; color:#1e293b; background:#f8fafc; }
    .card { max-width:820px; margin:0 auto; background:#fff; border:2px solid #0d9488; border-radius:16px; padding:24px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); }
    h2 { color:#0f766e; margin:0 0 6px 0; font-size:22px; }
    .sub { font-size:13px; color:#64748b; margin-bottom:16px; font-weight:600; }
    .meta { font-size:14px; margin-bottom:20px; padding:12px; background:#f0fdfa; border-radius:10px; border:1px solid #ccfbf1; display:flex; justify-content:space-around; flex-wrap:wrap; gap:8px; }
    .meta span { color:#0f766e; font-weight:bold; }
    img { max-width:100%; max-height:74vh; border-radius:12px; border:1px solid #cbd5e1; object-fit:contain; }
    @media print {
      body { padding:0; background:#fff; }
      .card { border:none; box-shadow:none; padding:10px; max-width:100%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>وصل تسديد رسمي</h2>
    <div class="sub">كلية التخطيط العمراني / الدراسات العليا / المتابعة المالية</div>
    <div class="meta">
      <div>الطالب: <span>${escHtml(activeReceiptStudent.fullName || '')}</span></div>
      <div>المبلغ: <span>${Number(activeReceiptPayment.amount || 0).toLocaleString('ar-IQ')} د.ع</span></div>
      <div>التاريخ: <span>${escHtml(activeReceiptPayment.date || '-')}</span></div>
      <div>المدقق: <span>${escHtml(activeReceiptPayment.auditor || '-')}</span></div>
    </div>
    <img src="${imgSrc}" alt="صورة الوصل">
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 350);
    };
  <\/script>
</body>
</html>`);
    win.document.close();
  }
}

function openReceiptInNewTab() {
  if (!activeReceiptPayment) return;
  const webAppUrl = activeReceiptPayment.receiptUrl || `${SCRIPT_URL}?action=view_receipt&id=${encodeURIComponent(activeReceiptPayment.id)}`;
  window.open(webAppUrl, '_blank');
}

// ============================================================
// EXPORT — Individual Student PDF (HTML Print method — full Arabic + receipt images)
// ============================================================
async function exportStudentPDF(id) {
  const student = students.find(s => s.id === id);
  if (!student) { showToast('الطالب غير موجود', 'error'); return; }

  showToast('جاري تجهيز ملف PDF...', 'info');

  const f = computeFinancials(student);
  const payments = student.payments || [];

  // ── 1. Gather receipt images for all payments ──────────────────
  const receiptImgs = {};
  for (const p of payments) {
    let img = p.receiptImage;
    // If not in memory, try localStorage cache
    if (!img) {
      const cache = loadReceiptsCache();
      img = (cache[student.id] && cache[student.id][p.id]) || null;
    }
    // If still missing but has URL, fetch from server
    if (!img && p.id) {
      try {
        const res = await fetch(`${SCRIPT_URL}?action=get_receipt&id=${encodeURIComponent(p.id)}`);
        const data = await res.json();
        if (data && data.receiptImage) {
          img = data.receiptImage;
          storeReceiptImage(student.id, p.id, img);
          p.receiptImage = img;
        }
      } catch (e) {
        console.warn('Receipt fetch failed for', p.id, e);
      }
    }
    if (img) receiptImgs[p.id] = img;
  }

  // ── 2. Build print-ready HTML ──────────────────────────────────
  const paymentRows = payments.map((p, i) => {
    const hasImg = Boolean(receiptImgs[p.id]);
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${p.date || '-'}</td>
        <td class="amount">${Number(p.amount || 0).toLocaleString('ar-IQ')} د.ع</td>
        <td>${p.auditor || '-'}</td>
        <td style="color:${hasImg ? '#0d9488' : '#94a3b8'};font-weight:bold">${hasImg ? '✅ مرفق' : '—'}</td>
      </tr>`;
  }).join('');

  const receiptPages = payments
    .filter(p => receiptImgs[p.id])
    .map((p, i) => `
      <div class="receipt-page">
        <div class="receipt-header">
          <h3>معلومات الدفعة ${i + 1}</h3>
          <div class="receipt-meta">
            <span>الطالب: <strong>${student.fullName || ''}</strong></span>
            <span>المبلغ: <strong>${Number(p.amount || 0).toLocaleString('ar-IQ')} د.ع</strong></span>
            <span>التاريخ: <strong>${p.date || '-'}</strong></span>
            <span>المدقق: <strong>${p.auditor || '-'}</strong></span>
          </div>
        </div>
        <div class="receipt-img-wrap">
          <img src="${receiptImgs[p.id]}" alt="صورة الوصل ${i + 1}">
        </div>
      </div>`).join('');

  const statusColor = f.isPaid ? '#16a34a' : f.paidAmount > 0 ? '#d97706' : '#dc2626';

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>وصل مالي — ${student.fullName || student.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;800&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Tajawal', Arial, sans-serif;
      direction: rtl;
      background: #fff;
      color: #1e293b;
      font-size: 13px;
      line-height: 1.6;
    }

    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 28px 32px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #0d9488;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .header-logo {
      width: 52px;
      height: 52px;
      background: #0d9488;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      color: #fff;
    }
    .header-text h1 {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
    }
    .header-text p {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
    }
    .header-id {
      text-align: left;
      font-size: 11px;
      color: #94a3b8;
    }
    .header-id strong {
      display: block;
      font-size: 12px;
      color: #475569;
      word-break: break-all;
    }

    /* ── Info Grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 20px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 18px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 10px;
      color: #94a3b8;
      font-weight: 600;
      margin-bottom: 2px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .info-value {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
    }

    /* ── Financial Summary ── */
    .fin-summary {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
      margin-bottom: 18px;
    }
    .fin-card {
      border-radius: 10px;
      padding: 12px 14px;
      text-align: center;
    }
    .fin-card .fc-label {
      font-size: 10px;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .fin-card .fc-value {
      font-size: 15px;
      font-weight: 800;
    }
    .fin-card.total  { background: #f1f5f9; }
    .fin-card.paid   { background: #f0fdf4; }
    .fin-card.paid   .fc-value { color: #16a34a; }
    .fin-card.remain { background: #fef2f2; }
    .fin-card.remain .fc-value { color: #dc2626; }
    .fin-card.total  .fc-value { color: #0f172a; }

    .status-badge {
      display: inline-block;
      padding: 5px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 800;
      color: ${statusColor};
      border: 2px solid ${statusColor};
      margin-bottom: 18px;
    }

    /* ── Payments Table ── */
    h2 {
      font-size: 14px;
      font-weight: 800;
      color: #0f766e;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    h2::before { content: ''; display: block; width: 4px; height: 18px; background: #0d9488; border-radius: 4px; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 24px;
    }
    thead tr {
      background: #0d9488;
      color: #fff;
    }
    th, td {
      padding: 8px 12px;
      text-align: right;
      border-bottom: 1px solid #e2e8f0;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody tr:hover { background: #f0fdfa; }
    td.amount { font-weight: 700; color: #0d9488; }

    /* ── Receipt Images ── */
    .receipt-page {
      page-break-before: always;
      padding: 24px 32px;
      max-width: 820px;
      margin: 0 auto;
    }
    .receipt-header {
      border-bottom: 3px solid #0d9488;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .receipt-header h3 {
      font-size: 16px;
      font-weight: 800;
      color: #0f766e;
      margin-bottom: 6px;
    }
    .receipt-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: #475569;
      background: #f0fdfa;
      padding: 8px 12px;
      border-radius: 8px;
    }
    .receipt-meta span { display: flex; gap: 4px; align-items: center; }
    .receipt-meta strong { color: #0f766e; }
    .receipt-img-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .receipt-img-wrap img {
      max-width: 100%;
      max-height: 85vh;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      object-fit: contain;
    }

    /* ── Footer ── */
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      margin-top: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #94a3b8;
    }

    @media print {
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page { padding: 16px 20px; }
      .receipt-page { padding: 16px 20px; }
    }
  </style>
</head>
<body>

<!-- ── Main Page ── -->
<div class="page">

  <div class="header">
    <div class="header-logo">🎓</div>
    <div class="header-text" style="flex:1; margin: 0 14px;">
      <h1>كلية التخطيط العمراني / الدراسات العليا / المتابعة المالية</h1>
    </div>
    <div class="header-id">
      <span>ID - NO.:</span>
      <strong>${student.id}</strong>
      <span style="display:block;margin-top:4px;">تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')}</span>
    </div>
  </div>

  <!-- Student Info -->
  <h2>بيانات الطالب</h2>
  <div class="info-grid">
    <div class="info-item">
      <span class="info-label">الاسم الرباعي</span>
      <span class="info-value">${student.fullName || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">القسم</span>
      <span class="info-value">${student.department || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">نوع الدراسة</span>
      <span class="info-value">${student.studyType || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">التخصص</span>
      <span class="info-value">${student.specialization || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">نوع النفقة</span>
      <span class="info-value">${student.expenseType || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">سنة القبول</span>
      <span class="info-value">${student.admissionYear || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">سنة التخرج المتوقعة</span>
      <span class="info-value">${student.graduationYear || '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">عدد الدفعات</span>
      <span class="info-value">${payments.length} دفعة</span>
    </div>
    <div class="info-item">
      <span class="info-label">نسبة التخفيض</span>
      <span class="info-value">${Number(student.discountPercent || 0)}%</span>
    </div>
  </div>

  <!-- Financial Summary -->
  <h2>بيانات الدفع</h2>
  <div class="fin-summary" style="grid-template-columns: repeat(4, 1fr);">
    <div class="fin-card total">
      <div class="fc-label">المبلغ المقرر</div>
      <div class="fc-value">${Number(f.totalFee).toLocaleString('ar-IQ')} د.ع</div>
    </div>
    <div class="fin-card" style="background:#faf5ff;">
      <div class="fc-label" style="color:#7e22ce;">نسبة التخفيض</div>
      <div class="fc-value" style="color:#6b21a8;">${Number(student.discountPercent || 0)}%</div>
    </div>
    <div class="fin-card paid">
      <div class="fc-label">إجمالي المسدد</div>
      <div class="fc-value">${Number(f.paidAmount).toLocaleString('ar-IQ')} د.ع</div>
    </div>
    <div class="fin-card remain">
      <div class="fc-label">المبلغ المتبقي</div>
      <div class="fc-value">${Number(f.remainingAmount).toLocaleString('ar-IQ')} د.ع</div>
    </div>
  </div>
  <div style="text-align:center; margin-bottom:18px;">
    <span class="status-badge">${f.status}</span>
  </div>

  <!-- Payments Table -->
  ${payments.length > 0 ? `
  <h2>سجل الدفعات</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>التاريخ</th>
        <th>المبلغ</th>
        <th>المدقق</th>
        <th>الوصل</th>
      </tr>
    </thead>
    <tbody>
      ${paymentRows}
    </tbody>
  </table>` : '<div style="text-align:center;color:#94a3b8;padding:20px;">لا توجد دفعات مسجلة</div>'}

  <div class="footer">
    <span>نظام متابعة الرسوم الدراسية — كلية التخطيط العمراني</span>
    <span>تم الإصدار: ${new Date().toLocaleString('ar-IQ')}</span>
  </div>

</div>

${receiptPages}

<script>
  window.onload = function() {
    document.fonts.ready.then(function() {
      setTimeout(function() { window.print(); }, 600);
    });
  };
<\/script>
</body>
</html>`;

  // ── 3. Open print window ───────────────────────────────────────
  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) {
    win.document.write(html);
    win.document.close();
    showToast('جاري فتح نافذة الطباعة / PDF...', 'success');
  } else {
    showToast('تعذّر فتح نافذة الطباعة. تحقق من إعدادات النوافذ المنبثقة.', 'error');
  }
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
      'نسبة التخفيض': (s.discountPercent || 0) + '%',
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

  const discountInput = $('discountPercentInput');
  if (discountInput) discountInput.addEventListener('input', handleDiscountChange);

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

  // Receipt modal close & backdrop
  const receiptModal = $('receiptModal');
  if (receiptModal) {
    receiptModal.addEventListener('click', (e) => {
      if (e.target === receiptModal) closeReceiptModal();
    });
  }

  // Keyboard shortcut (Escape to close any modal)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeReceiptModal();
      closeAddStudentModal();
    }
  });

  // Export buttons
  const excelBtn = $('exportExcelBtn');
  if (excelBtn) excelBtn.addEventListener('click', exportAllExcel);
}

document.addEventListener('DOMContentLoaded', init);
