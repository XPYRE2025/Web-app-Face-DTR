/* ===================================================
   Face DTR – Attendance Page Logic
   =================================================== */

'use strict';

/* ---- Face-api model URL ---- */
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

/* ---- DOM references ---- */
const video        = document.getElementById('video');
const overlayCanvas = document.getElementById('overlay');
const scanLine     = document.getElementById('scan-line');
const statusDot    = document.getElementById('status-dot');
const detectionLbl = document.getElementById('detection-label');
const resultBox    = document.getElementById('recognition-result');
const resultName   = document.getElementById('result-name');
const resultTime   = document.getElementById('result-time');
const resultType   = document.getElementById('result-type');
const resultConf   = document.getElementById('result-conf-fill');
const todayList    = document.getElementById('today-list');
const todayCount   = document.getElementById('today-count');

/* ---- State ---- */
let faceMatcher    = null;
let isDetecting    = false;
let resultTimeout  = null;

/* ---- System status badges ---- */
const sysStatus = {
  camera : document.getElementById('sys-camera'),
  models : document.getElementById('sys-models'),
  faces  : document.getElementById('sys-faces'),
};

function setSysStatus(key, state, label) {
  const el = sysStatus[key];
  if (!el) return;
  el.textContent = label;
  el.className = `sys-badge ${state}`;
}

/* ============================================================
   INITIALISATION
   ============================================================ */
async function init() {
  await initAdminHash();

  // Set up admin shortcut listener
  setupAdminShortcut();

  // Load models
  setSysStatus('models', 'loading', 'Loading…');
  try {
    await loadModels();
    setSysStatus('models', 'ok', 'Ready');
  } catch (err) {
    setSysStatus('models', 'error', 'Failed');
    detectionLbl.textContent = '⚠️ Model load failed. Check your connection.';
    showToast('Failed to load AI models. Please reload the page.', 'error', 6000);
    return;
  }

  // Start camera
  setSysStatus('camera', 'loading', 'Starting…');
  try {
    await startCamera();
    setSysStatus('camera', 'ok', 'Active');
    scanLine.classList.add('visible');
    statusDot.className = 'status-dot scanning';
  } catch (err) {
    setSysStatus('camera', 'error', 'No Access');
    detectionLbl.textContent = '⚠️ Camera access denied. Please allow camera access.';
    showToast('Camera access denied. Please allow camera permissions.', 'error', 6000);
    return;
  }

  // Build face matcher from stored users
  buildFaceMatcher();

  // Render today's attendance
  renderToday();

  // Start detection loop
  isDetecting = true;
  detectionLoop();
}

/* ============================================================
   LOAD FACE-API MODELS
   ============================================================ */
async function loadModels() {
  const progressEl   = document.getElementById('model-progress-fill');
  const progressLbl  = document.getElementById('model-progress-label');

  function setProgress(pct, label) {
    if (progressEl)  progressEl.style.width  = pct + '%';
    if (progressLbl) progressLbl.textContent = label;
  }

  setProgress(10, 'Loading face detector…');
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

  setProgress(40, 'Loading landmark model…');
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);

  setProgress(70, 'Loading recognition model…');
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

  setProgress(100, 'Models ready ✓');
}

/* ============================================================
   CAMERA
   ============================================================ */
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  return new Promise(resolve => { video.onloadedmetadata = () => resolve(); });
}

/* ============================================================
   FACE MATCHER
   ============================================================ */
function buildFaceMatcher() {
  const users = getUsers();
  if (users.length === 0) {
    setSysStatus('faces', 'loading', 'No faces');
    faceMatcher = null;
    return;
  }

  const labeledDescriptors = users
    .filter(u => u.descriptors && u.descriptors.length > 0)
    .map(u => new faceapi.LabeledFaceDescriptors(
      u.id,
      u.descriptors.map(d => deserializeDescriptor(d))
    ));

  if (labeledDescriptors.length === 0) {
    faceMatcher = null;
    setSysStatus('faces', 'loading', 'No faces');
    return;
  }

  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.55);
  setSysStatus('faces', 'ok', `${labeledDescriptors.length} registered`);
}

/* ============================================================
   DETECTION LOOP
   ============================================================ */
const DETECT_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

async function detectionLoop() {
  if (!isDetecting) return;

  try {
    const detections = await faceapi
      .detectAllFaces(video, DETECT_OPTIONS)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    drawDetections(detections);

    if (detections.length === 0) {
      detectionLbl.textContent = '👁️ Position your face in front of the camera';
      statusDot.className = 'status-dot scanning';
    } else if (!faceMatcher) {
      detectionLbl.textContent = `✅ ${detections.length} face(s) detected – No registered users yet`;
      statusDot.className = 'status-dot active';
    } else {
      for (const det of detections) {
        const match = faceMatcher.findBestMatch(det.descriptor);
        if (match.label !== 'unknown') {
          const user = getUsers().find(u => u.id === match.label);
          if (user) {
            const confidence = 1 - match.distance;
            handleRecognition(user, confidence);
          }
        } else {
          detectionLbl.textContent = '🔍 Face detected – Identity unknown';
          statusDot.className = 'status-dot scanning';
        }
      }
    }
  } catch (err) {
    /* Swallow detection errors silently to keep loop running */
  }

  requestAnimationFrame(detectionLoop);
}

/* ---- Draw face boxes on canvas ---- */
function drawDetections(detections) {
  if (!overlayCanvas) return;

  const dims = faceapi.matchDimensions(overlayCanvas, video, true);
  const resized = faceapi.resizeResults(detections, dims);

  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  resized.forEach(det => {
    const box = det.detection.box;
    ctx.strokeStyle = 'rgba(0,196,204,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Corner brackets
    const s = 14;
    ctx.strokeStyle = '#00c4cc';
    ctx.lineWidth = 3;
    [[box.x, box.y], [box.x + box.width, box.y],
     [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].forEach(([cx, cy]) => {
      ctx.beginPath();
      const dx = cx === box.x ? s : -s;
      const dy = cy === box.y ? s : -s;
      ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy);
      ctx.stroke();
    });
  });
}

/* ============================================================
   RECOGNITION HANDLER
   ============================================================ */
const cooldowns = {}; // userId -> timestamp

function handleRecognition(user, confidence) {
  const now = Date.now();
  const lastSeen = cooldowns[user.id] || 0;

  // Show the detection label
  detectionLbl.textContent = `✅ ${user.name} (${Math.round(confidence * 100)}% match)`;
  statusDot.className = 'status-dot active';

  // Cooldown: do not re-record if shown recently
  if (now - lastSeen < ATTENDANCE_COOLDOWN_MS) return;

  cooldowns[user.id] = now;

  const result = recordAttendance(user.id, user.name, user.department, confidence);

  if (result.status === 'recorded') {
    showRecognitionResult(user, result.record, confidence);
    renderToday();
    showToast(`${user.name} – ${result.record.type} recorded`, 'success');
  }
}

/* ---- Show result card ---- */
function showRecognitionResult(user, record, confidence) {
  resultName.textContent = user.name;
  resultTime.textContent = `${record.department} · ${formatTime(record.timestamp)}`;
  const typeEl = resultType;
  if (record.type === 'time-in') {
    typeEl.textContent = record.status === 'late' ? '🕐 Time-In (Late)' : '🟢 Time-In';
    typeEl.className = 'badge ' + (record.status === 'late' ? 'badge-late' : 'badge-in');
  } else {
    typeEl.textContent = '🟡 Time-Out';
    typeEl.className = 'badge badge-out';
  }
  if (resultConf) resultConf.style.width = Math.round(confidence * 100) + '%';

  resultBox.classList.add('visible');

  clearTimeout(resultTimeout);
  resultTimeout = setTimeout(() => resultBox.classList.remove('visible'), 5000);
}

/* ============================================================
   TODAY'S ATTENDANCE LIST
   ============================================================ */
function renderToday() {
  const records = getAttendanceToday();
  const users   = getUsers();

  if (todayCount) todayCount.textContent = records.length;

  if (!todayList) return;
  if (records.length === 0) {
    todayList.innerHTML = `<div class="empty-state"><span>📋</span><p>No attendance recorded today</p></div>`;
    return;
  }

  // Show most recent first, deduplicate by user showing latest
  const latest = {};
  [...records].reverse().forEach(r => { if (!latest[r.userId]) latest[r.userId] = r; });

  todayList.innerHTML = Object.values(latest).map(r => {
    const user = users.find(u => u.id === r.userId) || {};
    const initials = getInitials(r.userName || user.name || '?');
    return `
      <div class="today-item">
        <div class="today-avatar">${initials}</div>
        <div class="today-info">
          <div class="name">${escapeHtml(r.userName || user.name || 'Unknown')}</div>
          <div class="dept">${escapeHtml(r.department || 'General')}</div>
        </div>
        <div class="today-time">
          <div class="time">${formatTime(r.timestamp)}</div>
          <div class="type ${r.type === 'time-in' ? 'type-in' : 'type-out'}">${r.type}</div>
        </div>
      </div>`;
  }).join('');
}

/* ============================================================
   ADMIN SHORTCUT  (type A-D-M-I-N on keyboard)
   ============================================================ */
const SECRET_SEQUENCE = 'admin';
let keyBuffer = '';
let keyTimer  = null;

function setupAdminShortcut() {
  document.addEventListener('keydown', e => {
    // Ignore if user is typing in an input
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

    keyBuffer += e.key.toLowerCase();
    if (keyBuffer.length > SECRET_SEQUENCE.length) {
      keyBuffer = keyBuffer.slice(-SECRET_SEQUENCE.length);
    }

    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => { keyBuffer = ''; }, 2000);

    if (keyBuffer === SECRET_SEQUENCE) {
      keyBuffer = '';
      openAdminModal();
    }
  });
}

/* ---- Admin login modal ---- */
function openAdminModal() {
  const backdrop = document.getElementById('admin-modal-backdrop');
  if (backdrop) {
    backdrop.classList.add('open');
    document.getElementById('admin-pass-input')?.focus();
  }
}

function closeAdminModal() {
  const backdrop = document.getElementById('admin-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    document.getElementById('admin-pass-input').value = '';
    document.getElementById('admin-login-error').classList.add('hidden');
  }
}

async function submitAdminLogin(e) {
  if (e) e.preventDefault();
  const pass = document.getElementById('admin-pass-input')?.value || '';
  const errEl = document.getElementById('admin-login-error');

  if (!pass.trim()) {
    errEl.classList.remove('hidden');
    errEl.textContent = 'Please enter your password.';
    return;
  }

  const ok = await verifyAdminPassword(pass);
  if (ok) {
    sessionStorage.setItem('facedtr_admin', '1');
    window.location.href = 'admin.html';
  } else {
    errEl.classList.remove('hidden');
    errEl.textContent = '❌ Incorrect password. Please try again.';
    document.getElementById('admin-pass-input').value = '';
    document.getElementById('admin-pass-input').focus();
  }
}

/* ---- Password visibility toggle ---- */
function togglePassVisibility(btnEl) {
  const input = document.getElementById('admin-pass-input');
  if (!input || !btnEl) return;
  if (input.type === 'password') {
    input.type = 'text';
    btnEl.textContent = '🙈';
  } else {
    input.type = 'password';
    btnEl.textContent = '👁️';
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
