/* ===================================================
   Face DTR – Shared Utilities
   =================================================== */

'use strict';

/* ---- Storage keys ---- */
const STORAGE = {
  USERS: 'facedtr_users',
  ATTENDANCE: 'facedtr_attendance',
  ADMIN_HASH: 'facedtr_admin_hash',
};

/* Shared cooldown between consecutive scans for the same person (ms) */
const ATTENDANCE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

/* ---- UUID generator ---- */
function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* ---- SHA-256 via Web Crypto API ---- */
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- Storage helpers ---- */
function getUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE.USERS)) || []; }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(STORAGE.USERS, JSON.stringify(users));
}

function getAttendance() {
  try { return JSON.parse(localStorage.getItem(STORAGE.ATTENDANCE)) || []; }
  catch { return []; }
}

function saveAttendance(records) {
  localStorage.setItem(STORAGE.ATTENDANCE, JSON.stringify(records));
}

/* ---- Admin password helpers ---- */
async function initAdminHash() {
  if (!localStorage.getItem(STORAGE.ADMIN_HASH)) {
    const hash = await sha256('FaceDTR@Admin2025');
    localStorage.setItem(STORAGE.ADMIN_HASH, hash);
  }
}

async function verifyAdminPassword(password) {
  const stored = localStorage.getItem(STORAGE.ADMIN_HASH);
  if (!stored) {
    await initAdminHash();
  }
  const hash = await sha256(password);
  return hash === localStorage.getItem(STORAGE.ADMIN_HASH);
}

async function changeAdminPassword(newPassword) {
  const hash = await sha256(newPassword);
  localStorage.setItem(STORAGE.ADMIN_HASH, hash);
}

/* ---- Date/Time helpers ---- */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(dateStr) {
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`;
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday(dateStr) {
  return dateStr.startsWith(getTodayKey());
}

/* ---- Face descriptor serialization ---- */
function serializeDescriptor(descriptor) {
  return Array.from(descriptor);
}

function deserializeDescriptor(arr) {
  return new Float32Array(arr);
}

/* ---- Attendance helpers ---- */
function getAttendanceToday() {
  return getAttendance().filter(r => isToday(r.timestamp));
}

function recordAttendance(userId, userName, department, confidence) {
  const records = getAttendance();
  const today = getTodayKey();

  // Find today's records for this user
  const todayRecords = records.filter(r => r.userId === userId && r.timestamp.startsWith(today));
  const lastRecord = todayRecords[todayRecords.length - 1];

  // Cooldown: 2 minutes between consecutive scans for the same person
  if (lastRecord) {
    const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
    if (elapsed < ATTENDANCE_COOLDOWN_MS) {
      return { status: 'cooldown', record: lastRecord };
    }
  }

  // Determine type: first scan = time-in, second = time-out, alternates
  const type = (todayRecords.length % 2 === 0) ? 'time-in' : 'time-out';

  // Determine status for time-in records (late = after 9am)
  let status = null;
  if (type === 'time-in') {
    const hour = new Date().getHours();
    status = (hour >= 9) ? 'late' : 'on-time';
  }

  const record = {
    id: generateId(),
    userId,
    userName,
    department: department || 'General',
    type,
    status,
    confidence: Math.round(confidence * 100),
    timestamp: new Date().toISOString(),
  };

  records.push(record);
  saveAttendance(records);
  return { status: 'recorded', record };
}

/* ---- CSV Export ---- */
function exportAttendanceCSV(records) {
  const header = ['ID','Name','Department','Type','Status','Confidence %','Timestamp'];
  const rows = records.map(r => [
    r.id, r.userName, r.department, r.type,
    r.status || '', r.confidence || '', r.timestamp
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${getTodayKey()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---- Toast notifications ---- */
function showToast(message, type = 'default', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', default: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || icons.default}</span> ${message}`;
  toast.addEventListener('click', () => toast.remove());

  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .5s'; setTimeout(() => toast.remove(), 500); }, duration);
}

/* ---- Initials from name ---- */
function getInitials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}
