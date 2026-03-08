/* ===================================================
   Face DTR – Admin Panel Logic
   =================================================== */

'use strict';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

/* ---- State ---- */
let adminStream     = null;
let registerStream  = null;
let capturedSamples = [];   // Array of Float32Array descriptors
let capturedThumbs  = [];   // Array of data URLs
let isCapturing     = false;
let currentPage     = 1;
const PAGE_SIZE     = 10;
let regDetectOptions = null;

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');

  // Verify admin session
  if (!sessionStorage.getItem('facedtr_admin')) {
    // If this script is running on admin.html, stay on login view instead of redirecting.
    // Redirect only when this script is used on another protected page.
    if (loginView && adminView) {
      loginView.style.display = 'block';
      adminView.style.display = 'none';
      return;
    }
    window.location.href = 'admin.html';
    return;
  }

  // Ensure authenticated state shows the admin panel on admin.html
  if (loginView && adminView) {
    loginView.style.display = 'none';
    adminView.style.display = 'block';
  }

  // Update admin name display
  const stored = getUsers();
  updateStats();

  // Load face-api models
  showLoadingOverlay(true, 'Loading AI models…');
  try {
    await loadModels();
  } catch (err) {
    showToast('Failed to load AI models. Registration unavailable.', 'error', 6000);
  }
  showLoadingOverlay(false);

  // Nav
  document.querySelectorAll('.admin-nav-item[data-panel]').forEach(item => {
    item.addEventListener('click', () => switchPanel(item.dataset.panel));
  });

  // Render panels
  renderUsers();
  renderAttendanceTable();
  updateStats();

  // Start register camera on first load of register panel
  switchPanel('register');
}

/* ============================================================
   LOAD MODELS
   ============================================================ */
async function loadModels() {
  if (!window.faceapi) {
    throw new Error('face-api library failed to load');
  }

  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

  regDetectOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
}

/* ============================================================
   NAV PANEL SWITCHING
   ============================================================ */
function switchPanel(panelId) {
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(i => i.classList.remove('active'));

  const panel = document.getElementById('panel-' + panelId);
  const navItem = document.querySelector(`.admin-nav-item[data-panel="${panelId}"]`);
  if (panel) panel.classList.add('active');
  if (navItem) navItem.classList.add('active');

  if (panelId === 'register') {
    startRegisterCamera();
  } else {
    stopRegisterCamera();
  }

  if (panelId === 'attendance') {
    renderAttendanceTable();
  }
  if (panelId === 'users') {
    renderUsers();
  }
  if (panelId === 'dashboard') {
    updateStats();
  }
}

/* ============================================================
   REGISTER CAMERA
   ============================================================ */
async function startRegisterCamera() {
  const video   = document.getElementById('reg-video');
  const canvas  = document.getElementById('reg-overlay');
  if (!video) return;

  if (registerStream) return; // already running

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Camera is not supported in this browser or context.', 'error');
    return;
  }

  try {
    registerStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    video.srcObject = registerStream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => resolve();
    });

    await video.play();
    startRegisterDetectionLoop(video, canvas);
  } catch (err) {
    showToast('Camera access denied. Face capture unavailable.', 'error');
  }
}

function stopRegisterCamera() {
  if (registerStream) {
    registerStream.getTracks().forEach(t => t.stop());
    registerStream = null;
  }
}

/* ---- Detection loop for registration ---- */
async function startRegisterDetectionLoop(video, canvas) {
  async function loop() {
    if (!registerStream) return;
    if (!window.faceapi || !regDetectOptions) return;
    if (video.readyState >= 2) {
      try {
        const det = await faceapi.detectSingleFace(video, regDetectOptions).withFaceLandmarks(true);
        const ctx = canvas.getContext('2d');
        const dims = faceapi.matchDimensions(canvas, video, true);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const statusEl = document.getElementById('reg-status');

        if (det) {
          const resized = faceapi.resizeResults(det, dims);
          drawRegBox(ctx, resized.detection.box, true);
          if (statusEl) { statusEl.textContent = '✅ Face detected – ready to capture'; statusEl.style.color = 'var(--success)'; }
          document.getElementById('btn-capture')?.removeAttribute('disabled');
        } else {
          if (statusEl) { statusEl.textContent = '👤 Position your face in the frame'; statusEl.style.color = 'var(--text-muted)'; }
          document.getElementById('btn-capture')?.setAttribute('disabled', 'true');
        }
      } catch { /* ignore */ }
    }
    requestAnimationFrame(loop);
  }
  loop();
}

function drawRegBox(ctx, box, detected) {
  const color = detected ? 'rgba(0,196,204,0.9)' : 'rgba(255,255,255,0.3)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  const s = 12;
  ctx.strokeStyle = detected ? '#00c4cc' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  [[box.x, box.y], [box.x + box.width, box.y],
   [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].forEach(([cx, cy]) => {
    ctx.beginPath();
    const dx = cx === box.x ? s : -s;
    const dy = cy === box.y ? s : -s;
    ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy);
    ctx.stroke();
  });
}

/* ============================================================
   CAPTURE FACE SAMPLE
   ============================================================ */
async function captureSample() {
  if (capturedSamples.length >= 5) {
    showToast('Maximum 5 samples captured. You can save now.', 'warning');
    return;
  }

  const video  = document.getElementById('reg-video');
  const canvas = document.getElementById('reg-overlay');
  const btn    = document.getElementById('btn-capture');

  if (!video || isCapturing) return;
  isCapturing = true;
  btn?.setAttribute('disabled', 'true');

  try {
    const det = await faceapi
      .detectSingleFace(video, regDetectOptions)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!det) {
      showToast('No face detected. Please look at the camera.', 'warning');
      isCapturing = false;
      btn?.removeAttribute('disabled');
      return;
    }

    capturedSamples.push(serializeDescriptor(det.descriptor));

    // Grab thumbnail from video frame
    const thumb = document.createElement('canvas');
    thumb.width  = 80;
    thumb.height = 80;
    const tctx = thumb.getContext('2d');
    // Draw mirrored thumbnail
    tctx.save();
    tctx.scale(-1, 1);
    tctx.drawImage(video, -80, 0, 80, 80);
    tctx.restore();
    capturedThumbs.push(thumb.toDataURL('image/jpeg', 0.7));

    updateSampleGrid();
    showToast(`Sample ${capturedSamples.length}/5 captured ✅`, 'success', 2000);

    if (capturedSamples.length >= 3) {
      document.getElementById('btn-save-user')?.removeAttribute('disabled');
    }
  } catch (err) {
    showToast('Capture error. Try again.', 'error');
  }

  isCapturing = false;
  btn?.removeAttribute('disabled');
}

function updateSampleGrid() {
  const grid = document.getElementById('sample-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const cell = document.createElement('div');
    cell.className = `sample-thumb ${i < capturedSamples.length ? 'filled' : ''}`;
    if (capturedThumbs[i]) {
      const img = document.createElement('img');
      img.src = capturedThumbs[i];
      cell.appendChild(img);
    } else {
      cell.textContent = i < capturedSamples.length ? '✓' : `${i + 1}`;
    }
    grid.appendChild(cell);
  }
}

function clearCaptures() {
  capturedSamples = [];
  capturedThumbs  = [];
  updateSampleGrid();
  document.getElementById('btn-save-user')?.setAttribute('disabled', 'true');
}

/* ============================================================
   SAVE USER
   ============================================================ */
async function saveUser() {
  const nameEl = document.getElementById('reg-name');
  const deptEl = document.getElementById('reg-dept');
  const empEl  = document.getElementById('reg-empid');

  const name = nameEl?.value.trim();
  const dept = deptEl?.value.trim();
  const empId = empEl?.value.trim();

  if (!name) { showToast('Please enter the employee name.', 'warning'); nameEl?.focus(); return; }
  if (capturedSamples.length < 1) { showToast('Please capture at least 1 face sample.', 'warning'); return; }

  const users = getUsers();

  // Check duplicate name
  const existing = users.find(u => u.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    const confirmed = confirm(`A user named "${name}" already exists. Add more samples to their profile?`);
    if (confirmed) {
      existing.descriptors.push(...capturedSamples);
      // Keep max 10 descriptors
      if (existing.descriptors.length > 10) existing.descriptors = existing.descriptors.slice(-10);
      saveUsers(users);
      showToast(`Updated ${name}'s face samples (${existing.descriptors.length} total).`, 'success');
    }
  } else {
    const user = {
      id: generateId(),
      name,
      department: dept || 'General',
      employeeId: empId || '',
      registeredAt: new Date().toISOString(),
      descriptors: capturedSamples,
    };
    users.push(user);
    saveUsers(users);
    showToast(`${name} registered successfully! 🎉`, 'success');
  }

  // Reset form
  if (nameEl) nameEl.value = '';
  if (deptEl) deptEl.value = '';
  if (empEl)  empEl.value  = '';
  clearCaptures();
  updateStats();
  renderUsers();
}

/* ============================================================
   USERS PANEL
   ============================================================ */
function renderUsers() {
  const container = document.getElementById('users-grid');
  if (!container) return;

  const users = getUsers();
  const search = document.getElementById('user-search')?.value.toLowerCase() || '';
  const filtered = search ? users.filter(u => u.name.toLowerCase().includes(search) || (u.department || '').toLowerCase().includes(search)) : users;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>👥</span><p>${search ? 'No users match your search.' : 'No users registered yet.'}</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(u => `
    <div class="user-card" id="user-card-${u.id}" data-user-id="${u.id}">
      <div class="user-avatar">${getInitials(u.name)}</div>
      <div class="user-name">${escapeHtml(u.name)}</div>
      <div class="user-dept">${escapeHtml(u.department || 'General')}</div>
      ${u.employeeId ? `<div class="user-dept">ID: ${escapeHtml(u.employeeId)}</div>` : ''}
      <div class="user-samples">${u.descriptors?.length || 0} face sample${(u.descriptors?.length || 0) !== 1 ? 's' : ''}</div>
      <div class="user-actions">
        <button class="btn btn-sm btn-outline js-view-records" data-user-id="${u.id}">📊 Records</button>
        <button class="btn btn-sm btn-danger js-delete-user" data-user-id="${u.id}">🗑️</button>
      </div>
    </div>`).join('');

  // Event delegation – avoids inline handlers and XSS through name/id values
  container.querySelectorAll('.js-view-records').forEach(btn => {
    btn.addEventListener('click', () => viewUserAttendance(btn.dataset.userId));
  });
  container.querySelectorAll('.js-delete-user').forEach(btn => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.userId));
  });
}

function deleteUser(userId) {
  const userName = getUsers().find(u => u.id === userId)?.name || 'this user';
  if (!confirm(`Delete "${userName}" and all their attendance records? This cannot be undone.`)) return;

  const users = getUsers().filter(u => u.id !== userId);
  saveUsers(users);

  // Optionally remove attendance records too
  const attendance = getAttendance().filter(r => r.userId !== userId);
  saveAttendance(attendance);

  renderUsers();
  updateStats();
  showToast(`${userName} has been deleted.`, 'default');
}

function viewUserAttendance(userId) {
  const userFilterEl = document.getElementById('filter-user');
  if (userFilterEl) {
    const user = getUsers().find(u => u.id === userId);
    userFilterEl.value = user?.name || '';
  }
  switchPanel('attendance');
}

/* ============================================================
   ATTENDANCE TABLE
   ============================================================ */
function renderAttendanceTable() {
  const tbody    = document.getElementById('attendance-tbody');
  const dateEl   = document.getElementById('filter-date');
  const userEl   = document.getElementById('filter-user');
  const typeEl   = document.getElementById('filter-type');

  if (!tbody) return;

  let records = getAttendance();

  // Apply filters
  const dateVal = dateEl?.value || '';
  const userVal = (userEl?.value || '').toLowerCase().trim();
  const typeVal = typeEl?.value || '';

  if (dateVal) records = records.filter(r => r.timestamp.startsWith(dateVal));
  if (userVal) records = records.filter(r => r.userName?.toLowerCase().includes(userVal));
  if (typeVal) records = records.filter(r => r.type === typeVal);

  // Sort newest first
  records = [...records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Pagination
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;

  const start  = (currentPage - 1) * PAGE_SIZE;
  const paged  = records.slice(start, start + PAGE_SIZE);

  const countEl = document.getElementById('attendance-count');
  if (countEl) countEl.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;

  if (paged.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No attendance records found.</td></tr>`;
  } else {
    tbody.innerHTML = paged.map(r => {
      const badgeCls = r.type === 'time-in'
        ? (r.status === 'late' ? 'badge-late' : 'badge-in')
        : 'badge-out';
      const badgeLabel = r.type === 'time-in'
        ? (r.status === 'late' ? '🕐 Late' : '🟢 Time-In')
        : '🟡 Time-Out';
      return `
        <tr>
          <td>${formatDate(r.timestamp)}</td>
          <td><strong>${escapeHtml(r.userName || '')}</strong></td>
          <td>${escapeHtml(r.department || 'General')}</td>
          <td><span class="badge ${badgeCls}">${badgeLabel}</span></td>
          <td>${formatTime(r.timestamp)}</td>
          <td>${r.confidence ? r.confidence + '%' : '–'}</td>
        </tr>`;
    }).join('');
  }

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  if (currentPage > 1) html += `<button class="page-btn" onclick="goToPage(${currentPage-1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    } else if (Math.abs(i - currentPage) === 2) {
      html += `<span style="padding:.25rem">…</span>`;
    }
  }
  if (currentPage < totalPages) html += `<button class="page-btn" onclick="goToPage(${currentPage+1})">›</button>`;
  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderAttendanceTable();
}

/* ---- Filters ---- */
function applyFilters() {
  currentPage = 1;
  renderAttendanceTable();
}

function clearFilters() {
  const dateEl = document.getElementById('filter-date');
  const userEl = document.getElementById('filter-user');
  const typeEl = document.getElementById('filter-type');
  if (dateEl) dateEl.value = '';
  if (userEl) userEl.value = '';
  if (typeEl) typeEl.value = '';
  currentPage = 1;
  renderAttendanceTable();
}

/* ============================================================
   STATS
   ============================================================ */
function updateStats() {
  const users      = getUsers();
  const records    = getAttendance();
  const todayRecs  = records.filter(r => isToday(r.timestamp));
  const todayIn    = todayRecs.filter(r => r.type === 'time-in');
  // Unique people present today
  const presentIds = [...new Set(todayIn.map(r => r.userId))];

  const el = id => document.getElementById(id);
  if (el('stat-total-users'))   el('stat-total-users').textContent   = users.length;
  if (el('stat-present-today')) el('stat-present-today').textContent = presentIds.length;
  if (el('stat-total-records')) el('stat-total-records').textContent = records.length;
  if (el('stat-late-today'))    el('stat-late-today').textContent    = todayIn.filter(r => r.status === 'late').length;
}

/* ============================================================
   EXPORT CSV
   ============================================================ */
function exportCSV() {
  const dateEl = document.getElementById('filter-date');
  const userEl = document.getElementById('filter-user');
  const typeEl = document.getElementById('filter-type');

  let records = getAttendance();
  const dateVal = dateEl?.value || '';
  const userVal = (userEl?.value || '').toLowerCase().trim();
  const typeVal = typeEl?.value || '';

  if (dateVal) records = records.filter(r => r.timestamp.startsWith(dateVal));
  if (userVal) records = records.filter(r => r.userName?.toLowerCase().includes(userVal));
  if (typeVal) records = records.filter(r => r.type === typeVal);

  if (records.length === 0) { showToast('No records to export.', 'warning'); return; }

  exportAttendanceCSV(records);
  showToast(`Exported ${records.length} records to CSV.`, 'success');
}

/* ============================================================
   CHANGE PASSWORD
   ============================================================ */
async function submitChangePassword(e) {
  e.preventDefault();
  const current  = document.getElementById('change-pass-current')?.value || '';
  const newPass  = document.getElementById('change-pass-new')?.value || '';
  const confirm_ = document.getElementById('change-pass-confirm')?.value || '';
  const errEl    = document.getElementById('change-pass-error');

  if (!current || !newPass || !confirm_) {
    if (errEl) { errEl.textContent = 'Please fill all fields.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (newPass !== confirm_) {
    if (errEl) { errEl.textContent = 'New passwords do not match.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (newPass.length < 8) {
    if (errEl) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('hidden'); }
    return;
  }

  const ok = await verifyAdminPassword(current);
  if (!ok) {
    if (errEl) { errEl.textContent = 'Current password is incorrect.'; errEl.classList.remove('hidden'); }
    return;
  }

  await changeAdminPassword(newPass);
  if (errEl) errEl.classList.add('hidden');
  document.getElementById('change-pass-current').value = '';
  document.getElementById('change-pass-new').value = '';
  document.getElementById('change-pass-confirm').value = '';
  showToast('Password changed successfully!', 'success');
}

/* ============================================================
   LOGOUT
   ============================================================ */
function logout() {
  sessionStorage.removeItem('facedtr_admin');
  stopRegisterCamera();
  window.location.href = 'admin.html';
}

/* ============================================================
   LOADING OVERLAY
   ============================================================ */
function showLoadingOverlay(show, msg = '') {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
    const msgEl = el.querySelector('.loading-msg');
    if (msgEl) msgEl.textContent = msg;
  } else {
    el.classList.add('hidden');
  }
}

/* ---- Helpers ---- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
