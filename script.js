cat > /mnt/user-data/outputs/script.js << 'ENDOFFILE'
// script.js — Smart Watering System Dashboard
// Sinkron dengan Arduino (Firebase_ESP_Client)
// Threshold: KERING < 45%, BASAH >= 70%, LEMBAB 45-69%
//
// ARSITEKTUR VALVE (dipisah per mode):
//   /area_X/valve_auto   → ditulis Arduino saat AUTO (web hanya baca)
//   /area_X/valve_manual → ditulis Web saat MANUAL (Arduino baca & eksekusi)
//   /area_X/valve        → hasil akhir (ditulis Arduino, gabungan kedua state)
//
// Dengan cara ini, state AUTO dan MANUAL tidak saling mempengaruhi.
// ==========================================

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDhoFPppidsW_oxPHbCteZO2_SPdLSnwtA",
  authDomain:        "penyiraman-otomatis-2728b.firebaseapp.com",
  databaseURL:       "https://penyiraman-otomatis-2728b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "penyiraman-otomatis-2728b",
  storageBucket:     "penyiraman-otomatis-2728b.firebasestorage.app",
  messagingSenderId: "167460818346",
  appId:             "1:167460818346:web:6dd143cf87e753e2586fd3",
  measurementId:     "G-3GEZYGSLLF"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ==========================================
// THRESHOLD — sama persis dengan Arduino
// ==========================================
const THRESHOLD_KERING = 45;
const THRESHOLD_BASAH  = 70;

// ==========================================
// STATE GLOBAL
// ==========================================
let mode             = 'auto';
let selectedArea     = 0;
let history          = [];
let historyModalOpen = false;

// State valve manual disimpan lokal di web, terpisah dari valve_auto Arduino
// Nilai awal false semua — tidak mengikuti kondisi AUTO
let manualValveStates = [false, false, false, false];

let areas = [
  { name:'Area 1', sensor:'Sensor 1', adc:0, hum:0, valve_auto:false, valve_manual:false, valve:false, status:'LEMBAB' },
  { name:'Area 2', sensor:'Sensor 2', adc:0, hum:0, valve_auto:false, valve_manual:false, valve:false, status:'LEMBAB' },
  { name:'Area 3', sensor:'Sensor 3', adc:0, hum:0, valve_auto:false, valve_manual:false, valve:false, status:'LEMBAB' },
  { name:'Area 4', sensor:'Sensor 4', adc:0, hum:0, valve_auto:false, valve_manual:false, valve:false, status:'LEMBAB' },
];

let chartData = { labels:[], series:[[],[],[],[]] };

// ==========================================
// UTILITAS
// ==========================================
function soilStatus(statusText) {
  if (statusText === 'KERING') return { label:'Kering', cls:'b-kering' };
  if (statusText === 'LEMBAB') return { label:'Lembap', cls:'b-lembap' };
  if (statusText === 'BASAH')  return { label:'Basah',  cls:'b-basah'  };
  return { label:'Error', cls:'b-kering' };
}

function calcStatus(hum) {
  if (hum < THRESHOLD_KERING) return 'KERING';
  if (hum >= THRESHOLD_BASAH) return 'BASAH';
  return 'LEMBAB';
}

function fmtTime(d) {
  return d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = fmtTime(new Date());
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// HANDLER DATA REALTIME FIREBASE
// ==========================================
function handleRealtimeDataFromFirebase(data) {

  // --- A. Sinkronisasi Mode ---
  if (data.mode) {
    const fbMode = data.mode.toUpperCase();
    if      (fbMode === 'AUTO')   mode = 'auto';
    else if (fbMode === 'MANUAL') mode = 'manual';
    else                          mode = 'idle';

    const btnAuto   = document.getElementById('btnAuto');
    const btnManual = document.getElementById('btnManual');
    const sidePanel = document.getElementById('sidePanel');

    if (btnAuto)   btnAuto.classList.toggle('inactive', mode !== 'auto');
    if (btnManual) btnManual.classList.toggle('active',  mode === 'manual');
    if (sidePanel) sidePanel.classList.toggle('open',    mode === 'manual');
  }

  // --- B. Sinkronisasi Data Area 1-4 ---
  for (let i = 0; i < 4; i++) {
    const key = `area_${i + 1}`;
    if (data[key]) {
      areas[i].hum    = data[key].humidity    !== undefined ? data[key].humidity    : areas[i].hum;
      areas[i].adc    = data[key].adc         !== undefined ? data[key].adc         : areas[i].adc;
      areas[i].status = data[key].status      || calcStatus(areas[i].hum);

      // Baca valve_auto (hasil keputusan Arduino saat AUTO)
      areas[i].valve_auto = data[key].valve_auto !== undefined ? data[key].valve_auto : areas[i].valve_auto;

      // Baca valve_manual (state yang web tulis saat MANUAL)
      // Sinkronkan juga ke array lokal supaya konsisten
      if (data[key].valve_manual !== undefined) {
        areas[i].valve_manual      = data[key].valve_manual;
        manualValveStates[i]       = data[key].valve_manual;
      }

      // valve (hasil akhir relay) — ditulis Arduino, hanya untuk display
      areas[i].valve = data[key].valve !== undefined ? data[key].valve : areas[i].valve;
    }
  }

  // --- C. Tidak ada override valve dari web ---
  // AUTO  : Arduino tulis valve_auto → Arduino baca → eksekusi relay → tulis /valve
  // MANUAL: Web tulis valve_manual   → Arduino baca → eksekusi relay → tulis /valve
  // Web hanya membaca hasil akhir /valve untuk ditampilkan

  // --- D. Riwayat ---
  // Tampilkan valve sesuai mode aktif agar riwayat akurat
  const displayValve = mode === 'auto'
    ? areas[selectedArea].valve_auto
    : areas[selectedArea].valve_manual;

  history.unshift({
    time:   fmtTime(new Date()),
    area:   areas[selectedArea].name,
    adc:    areas[selectedArea].adc,
    hum:    areas[selectedArea].hum,
    valve:  displayValve,
    status: areas[selectedArea].status,
    mode:   mode.toUpperCase()
  });

  // --- E. Render ---
  renderAreas();
  renderHistory();
  pushChartPoint();
  if (mode === 'manual') renderSidePanel();
}

// ==========================================
// RENDER KARTU AREA
// ==========================================
function renderAreas() {
  const grid = document.getElementById('areaGrid');
  if (!grid) return;
  grid.innerHTML = '';

  areas.forEach((a, i) => {
    const statusText = a.status || calcStatus(a.hum);
    const s = soilStatus(statusText);

    // Pilih valve yang ditampilkan sesuai mode
    // AUTO   → tampilkan valve_auto (keputusan Arduino)
    // MANUAL → tampilkan valve_manual (keputusan Web)
    const displayValve = mode === 'auto' ? a.valve_auto : a.valve_manual;
    const valveLabel   = mode === 'auto'
      ? (displayValve ? '🌿 TERBUKA (Auto)'   : '🚫 TERTUTUP (Auto)')
      : (displayValve ? '🌿 TERBUKA (Manual)' : '🚫 TERTUTUP (Manual)');

    const card = document.createElement('div');
    card.className = 'area-card' + (mode === 'manual' && selectedArea === i ? ' selected' : '');
    card.onclick = () => {
      if (mode === 'manual') {
        selectedArea = i;
        document.getElementById('areaSelect').value = i;
        renderSidePanel();
        renderAreas();
      }
    };

    card.innerHTML = `
      <div class="area-title">🌿 ${a.name.toUpperCase()}</div>
      <div class="area-sub">(${a.sensor})</div>
      <div class="metrics">
        <div class="metric"><div class="k">ADC</div><div class="v" style="font-size:16px;">${a.adc}</div></div>
        <div class="metric"><div class="k">KELEMBAPAN</div><div class="v">${a.hum}%</div></div>
      </div>
      <div class="k">STATUS TANAH</div>
      <span class="badge ${s.cls}">${s.label}</span>
      <div class="valve-row">STATUS VALVE
        <span class="valve-status ${displayValve ? 'v-open' : 'v-closed'}">${valveLabel}</span>
      </div>`;
    grid.appendChild(card);
  });

  // Rata-rata kelembapan
  const avg = Math.round(areas.reduce((s, a) => s + a.hum, 0) / areas.length);
  document.getElementById('avgValue').textContent = avg + '%';
  document.getElementById('avgCat').textContent   = soilStatus(calcStatus(avg)).label.toUpperCase();

  document.getElementById('sumMode').textContent  = mode.toUpperCase();

  // Hitung valve aktif sesuai mode
  const activeValveCount = mode === 'auto'
    ? areas.filter(a => a.valve_auto).length
    : areas.filter(a => a.valve_manual).length;
  document.getElementById('sumValve').textContent = activeValveCount;
  document.getElementById('sumTime').textContent  = fmtTime(new Date());

  // Pompa ON jika minimal 1 valve aktif (sesuai mode)
  const pumpOn = mode === 'auto'
    ? areas.some(a => a.valve_auto)
    : areas.some(a => a.valve_manual);

  const pumpEl = document.getElementById('pumpValue');
  if (pumpEl) {
    pumpEl.textContent = pumpOn ? 'ON' : 'OFF';
    pumpEl.style.color = pumpOn ? 'var(--green)' : 'var(--red)';
  }
  const subEl = document.getElementById('pumpSub');
  if (subEl) {
    subEl.textContent = mode === 'auto'
      ? 'Otomatis (Dikendalikan Arduino)'
      : 'Manual (Mengikuti Kontrol Web)';
  }
}

// ==========================================
// RENDER TABEL RIWAYAT
// ==========================================
function renderHistory() {
  const body = document.getElementById('historyBody');
  if (!body) return;
  body.innerHTML = '';
  history.slice(0, 8).forEach(h => {
    const s  = soilStatus(h.status || calcStatus(h.hum));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${h.time}</td>
      <td>${h.area}</td>
      <td>${h.adc}</td>
      <td>${h.hum}%</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td><span class="valve-status ${h.valve ? 'v-open' : 'v-closed'}">${h.valve ? 'TERBUKA' : 'TERTUTUP'}</span></td>
      <td>${h.mode}</td>`;
    body.appendChild(tr);
  });
  renderHistoryModal();
}

function renderHistoryModal() {
  if (!historyModalOpen) return;
  const body = document.getElementById('historyModalBody');
  if (!body) return;
  body.innerHTML = '';
  history.forEach(h => {
    const s  = soilStatus(h.status || calcStatus(h.hum));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${h.time}</td>
      <td>${h.area}</td>
      <td>${h.adc}</td>
      <td>${h.hum}%</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td><span class="valve-status ${h.valve ? 'v-open' : 'v-closed'}">${h.valve ? 'TERBUKA' : 'TERTUTUP'}</span></td>
      <td>${h.mode}</td>`;
    body.appendChild(tr);
  });
}

function openHistoryModal() {
  historyModalOpen = true;
  const modal = document.getElementById('historyModal');
  if (modal) modal.classList.add('open');
  renderHistoryModal();
}
function closeHistoryModal() {
  historyModalOpen = false;
  const modal = document.getElementById('historyModal');
  if (modal) modal.classList.remove('open');
}

// ==========================================
// CHART.JS
// ==========================================
const ctxEl = document.getElementById('chart');
let chart;
if (ctxEl) {
  const ctx = ctxEl.getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [
        { label:'Area 1 (Sensor 1)', data:chartData.series[0], borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,.1)',  tension:.3, pointRadius:3, fill:false },
        { label:'Area 2 (Sensor 2)', data:chartData.series[1], borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.1)', tension:.3, pointRadius:3, fill:false },
        { label:'Area 3 (Sensor 3)', data:chartData.series[2], borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,.1)', tension:.3, pointRadius:3, fill:false },
        { label:'Area 4 (Sensor 4)', data:chartData.series[3], borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,.1)',  tension:.3, pointRadius:3, fill:false },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0, max: 100,
          title: { display:true, text:'Kelembapan (%)' },
          grid: {
            color: ctx2 => {
              if (ctx2.tick.value === THRESHOLD_KERING) return 'rgba(220,38,38,.35)';
              if (ctx2.tick.value === THRESHOLD_BASAH)  return 'rgba(37,99,235,.35)';
              return 'rgba(0,0,0,.08)';
            }
          }
        }
      },
      plugins: {
        legend: { position:'bottom', labels:{ boxWidth:12 } },
        tooltip: {
          callbacks: {
            afterLabel: item => {
              const v = item.raw;
              if (v < THRESHOLD_KERING) return `KERING (<${THRESHOLD_KERING}%) — valve BUKA`;
              if (v >= THRESHOLD_BASAH) return `BASAH (>=${THRESHOLD_BASAH}%) — valve TUTUP`;
              return `Lembap — valve dipertahankan`;
            }
          }
        }
      }
    }
  });
}

function pushChartPoint() {
  if (!chart) return;
  chartData.labels.push(fmtTime(new Date()));
  areas.forEach((a, i) => chartData.series[i].push(a.hum));
  if (chartData.labels.length > 10) {
    chartData.labels.shift();
    chartData.series.forEach(s => s.shift());
  }
  chart.update();
}

// ==========================================
// KIRIM PERINTAH KE FIREBASE
// ==========================================
function sendFirebaseCommand(cmdObj) {
  const root = ref(db, '/');

  if (cmdObj.command === 'SET_MODE') {
    update(root, { mode: cmdObj.value.toUpperCase() });
  }
  else if (cmdObj.command === 'TOGGLE_VALVE_MANUAL') {
    // Hanya tulis ke valve_manual — tidak menyentuh valve_auto sama sekali
    if (mode !== 'manual') {
      console.warn('[Web] Perintah valve_manual diabaikan: bukan mode MANUAL');
      return;
    }
    const areaKey = `area_${cmdObj.areaIndex + 1}`;
    const updates = {};
    updates[`${areaKey}/valve_manual`] = cmdObj.value === 'true';
    update(root, updates);
  }
  else if (cmdObj.command === 'RESET_SYSTEM') {
    // Reset valve_manual semua area ke false saat reset
    const updates = { command_trigger: 'RESET' };
    for (let i = 0; i < 4; i++) {
      updates[`area_${i + 1}/valve_manual`] = false;
    }
    update(root, updates);
  }
}

// ==========================================
// KONTROL MODE
// ==========================================
function setMode(m) {
  mode = m;
  document.getElementById('btnAuto').classList.toggle('inactive', m !== 'auto');
  document.getElementById('btnManual').classList.toggle('active',  m === 'manual');
  document.getElementById('sidePanel').classList.toggle('open',    m === 'manual');

  sendFirebaseCommand({ command:'SET_MODE', value: m });

  // Saat beralih ke MANUAL: valve_manual mulai dari false (keputusan sendiri)
  // TIDAK mewarisi state dari valve_auto
  if (m === 'manual') {
    // Tampilkan valve_manual saat ini (sudah tersimpan di Firebase),
    // tidak di-reset agar user bisa lanjut dari state manual sebelumnya
    renderSidePanel();
  }

  renderAreas();
}

// ==========================================
// PANEL MANUAL (Sidebar)
// ==========================================
function renderSidePanel() {
  const sel = document.getElementById('areaSelect');
  if (sel && sel.options.length === 0) {
    areas.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Valve Area ${i + 1}`;
      sel.appendChild(opt);
    });
  }
  if (sel) selectedArea = parseInt(sel.value || selectedArea);

  const a = areas[selectedArea];
  const s = soilStatus(a.status || calcStatus(a.hum));

  document.getElementById('sideAdc').textContent   = a.adc;
  document.getElementById('sideHum').textContent   = a.hum + '%';
  document.getElementById('sideSoil').innerHTML    = `<span class="badge ${s.cls}">${s.label}</span>`;

  // Panel manual selalu tampilkan valve_manual, bukan valve_auto
  const manualVal = a.valve_manual;
  document.getElementById('sideValve').textContent = manualVal ? 'TERBUKA' : 'TERTUTUP';
  document.getElementById('sideValve').style.color = manualVal ? 'var(--green)' : 'var(--red)';
  document.getElementById('valveToggle').checked   = manualVal;
}

function toggleValve() {
  if (mode !== 'manual') return;
  const checked = document.getElementById('valveToggle').checked;

  // Update lokal hanya valve_manual — valve_auto tidak disentuh
  areas[selectedArea].valve_manual = checked;
  manualValveStates[selectedArea]  = checked;

  sendFirebaseCommand({
    command: 'TOGGLE_VALVE_MANUAL',
    areaIndex: selectedArea,
    value: checked ? 'true' : 'false'
  });

  renderSidePanel();
  renderAreas();
}

// ==========================================
// RESET SISTEM
// ==========================================
function resetSystem() {
  // Reset valve_manual semua area ke false
  manualValveStates = [false, false, false, false];
  areas.forEach(a => { a.valve_manual = false; });

  sendFirebaseCommand({ command:'RESET_SYSTEM', value:'restart', areaIndex:-1 });

  history = [];
  chartData.labels.length = 0;
  chartData.series.forEach(s => s.length = 0);
  if (chart) chart.update();

  setMode('auto');
  renderHistory();
  alert('Reset berhasil. valve_manual direset. Perintah dikirim ke Firebase → Arduino.');
}

// ==========================================
// EXPORT EXCEL
// ==========================================
function exportHistoryToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Library XLSX belum termuat. Cek koneksi internet.');
    return;
  }
  if (history.length === 0) {
    alert('Belum ada data riwayat untuk diexport.');
    return;
  }

  const rows = history.map(h => ({
    'Waktu':          h.time,
    'Area':           h.area,
    'ADC':            h.adc,
    'Kelembapan (%)': h.hum,
    'Status Tanah':   h.status || calcStatus(h.hum),
    'Status Valve':   h.valve ? 'TERBUKA' : 'TERTUTUP',
    'Mode':           h.mode
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [ {wch:12},{wch:10},{wch:8},{wch:14},{wch:14},{wch:14},{wch:10} ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Riwayat Kelembapan');

  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `riwayat_kelembapan_${stamp}.xlsx`);
}

// ==========================================
// EXPOSE KE GLOBAL
// ==========================================
window.setMode              = setMode;
window.toggleValve          = toggleValve;
window.resetSystem          = resetSystem;
window.renderSidePanel      = renderSidePanel;
window.exportHistoryToExcel = exportHistoryToExcel;
window.openHistoryModal     = openHistoryModal;
window.closeHistoryModal    = closeHistoryModal;

// ==========================================
// LISTENER REALTIME FIREBASE
// ==========================================
onValue(ref(db, '/'), (snapshot) => {
  const data = snapshot.val();
  if (data) handleRealtimeDataFromFirebase(data);
});

renderAreas();
renderHistory();
ENDOFFILE
