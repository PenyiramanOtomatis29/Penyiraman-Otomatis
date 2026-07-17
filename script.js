// script.js (Logika Dashboard Smart Watering System)
// ==========================================
// INISIALISASI FIREBASE (SDK v10)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Konfigurasi Firebase (Hanya Kredensial, Rules Tidak Berubah)
const firebaseConfig = {
  apiKey: "AIzaSyDhoFPppidsW_oxPHbCteZO2_SPdLSnwtA", // Ganti dengan API Key Anda
  authDomain: "penyiraman-otomatis-2728b.firebaseapp.com",
  databaseURL: "https://penyiraman-otomatis-2728b-default-rtdb.asia-southeast1.firebasedatabase.app", // Ganti dengan URL RTDB Anda
  projectId: "penyiraman-otomatis-2728b",
  storageBucket: "penyiraman-otomatis-2728b.firebasestorage.app",
  messagingSenderId: "167460818346",
  appId: "1:167460818346:web:6dd143cf87e753e2586fd3",
  measurementId: "G-3GEZYGSLLF"
};

// Inisialisasi Firebase App dan Database
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// STATE & VARIABEL GLOBAL DASHBOARD
// ==========================================
let mode = 'auto';              // Default mode lokal
let selectedArea = 0;           // Area yang dipilih untuk Mode Manual
let history = [];                // Data riwayat sementara (sama seperti kode awal)
let historyModalOpen = false;    // Status modal "Lihat Semua"

// Struktur Data Lokal untuk 4 Area
let areas = [
  { name:'Area 1', sensor:'Sensor 1', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 2', sensor:'Sensor 2', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 3', sensor:'Sensor 3', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 4', sensor:'Sensor 4', adc:0, hum:0, valve:false, status:'LEMBAB' },
];

// Data Struktur untuk Grafik Kelembapan (Range 0-100%)
// PENTING: objek & array ini TIDAK BOLEH diganti dengan objek baru (lihat resetSystem),
// karena Chart.js menyimpan REFERENSI ke array chartData.series[i] saat chart dibuat.
let chartData = { labels:[], series:[[],[],[],[]] };

// ==========================================
// FUNGSI UTILITAS & UI
// ==========================================
function soilStatus(statusText){
  if(statusText === 'KERING') return {label:'Kering', cls:'b-kering'};
  if(statusText === 'LEMBAB') return {label:'Lembap', cls:'b-lembap'};
  if(statusText === 'BASAH') return {label:'Basah', cls:'b-basah'};
  return {label:'Error', cls:'b-kering'};
}

function fmtTime(d){
  return d.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

function updateClock(){
  const clockEl = document.getElementById('clock');
  if(clockEl) clockEl.textContent = fmtTime(new Date());
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// LOGIKA PEMROSESAN DATA DARI FIREBASE
// ==========================================
function handleRealtimeDataFromFirebase(data) {
  // A. Sinkronisasi Mode (AUTO/MANUAL)
  if (data.mode) {
    mode = (data.mode === 'AUTO') ? 'auto' : 'manual';
    const btnAuto = document.getElementById('btnAuto');
    const btnManual = document.getElementById('btnManual');
    const sidePanel = document.getElementById('sidePanel');

    if(btnAuto) btnAuto.classList.toggle('inactive', mode !== 'auto');
    if(btnManual) btnManual.classList.toggle('active', mode === 'manual');
    if(sidePanel) sidePanel.classList.toggle('open', mode === 'manual');
  }

  // B. Sinkronisasi Data Area 1 - 4
  for (let i = 0; i < 4; i++) {
    const areaKey = `area_${i+1}`;
    if (data[areaKey]) {
      areas[i].hum = data[areaKey].humidity !== undefined ? data[areaKey].humidity : areas[i].hum;
      areas[i].valve = data[areaKey].valve !== undefined ? data[areaKey].valve : areas[i].valve;
      areas[i].status = data[areaKey].status || areas[i].status;
      areas[i].adc = data[areaKey].adc !== undefined ? data[areaKey].adc : areas[i].adc;
    }
  }

  // C. Update Riwayat & Grafik (Menambahkan Titik Data Baru) — persis seperti kode awal
  const t = fmtTime(new Date());
  history.unshift({time:t, area:areas[selectedArea].name, adc:areas[selectedArea].adc, hum:areas[selectedArea].hum, valve:areas[selectedArea].valve, mode:mode.toUpperCase()});

  // D. Render Ulang Semua Komponen Dashboard
  renderAreas();
  renderHistory();
  pushChartPoint();
  if(mode === 'manual') renderSidePanel();
}

// Merender Kartu Area Secara Realtime
function renderAreas(){
  const grid = document.getElementById('areaGrid');
  if(!grid) return;
  grid.innerHTML = '';

  areas.forEach((a, i)=>{
    const s = soilStatus(a.status);
    const card = document.createElement('div');
    card.className = 'area-card' + (mode==='manual' && selectedArea===i ? ' selected' : '');
    card.onclick = () => {
      if(mode==='manual'){
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
        <span class="valve-status ${a.valve?'v-open':'v-closed'}">${a.valve?'🌿 TERBUKA':'🚫 TERTUTUP'}</span>
      </div>`;
    grid.appendChild(card);
  });

  // Rata-rata kelembapan seluruh area
  const totalHum = areas.reduce((s, a) => s + a.hum, 0);
  const avg = Math.round(totalHum / areas.length);
  document.getElementById('avgValue').textContent = avg + '%';

  let avgCatText = 'LEMBAB';
  if (avg <= 30) avgCatText = 'KERING';
  else if (avg >= 60) avgCatText = 'BASAH';

  document.getElementById('avgCat').textContent = soilStatus(avgCatText).label.toUpperCase();

  document.getElementById('sumMode').textContent = mode.toUpperCase();
  document.getElementById('sumValve').textContent = areas.filter(a=>a.valve).length;
  document.getElementById('sumTime').textContent = fmtTime(new Date());

  const pumpOn = areas.some(a=>a.valve);
  document.getElementById('pumpValue').textContent = pumpOn ? 'ON' : 'OFF';
  document.getElementById('pumpValue').style.color = pumpOn ? 'var(--green)' : 'var(--red)';
  document.getElementById('pumpSub').textContent = mode==='auto' ? 'Otomatis (Mengikuti Valve)' : 'Manual (Mengikuti Kontrol)';
}

// Merender Tabel Riwayat Data Realtime — persis seperti kode awal (8 baris terakhir)
function renderHistory(){
  const body = document.getElementById('historyBody');
  if(!body) return;
  body.innerHTML = '';
  history.slice(0,8).forEach(h=>{
    const s = soilStatus(h.hum < 30 ? 'KERING' : h.hum <= 60 ? 'LEMBAB' : 'BASAH');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.time}</td><td>${h.area}</td><td>${h.adc}</td><td>${h.hum}%</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td><span class="valve-status ${h.valve?'v-open':'v-closed'}">${h.valve?'TERBUKA':'TERTUTUP'}</span></td>
      <td>${h.mode}</td>`;
    body.appendChild(tr);
  });

  // Kalau modal "Lihat Semua" sedang terbuka, ikut update live juga
  renderHistoryModal();
}

// Merender SELURUH riwayat di dalam modal "Lihat Semua" (live-update selama modal terbuka)
function renderHistoryModal(){
  if(!historyModalOpen) return;
  const body = document.getElementById('historyModalBody');
  if(!body) return;
  body.innerHTML = '';
  history.forEach(h=>{
    const s = soilStatus(h.hum < 30 ? 'KERING' : h.hum <= 60 ? 'LEMBAB' : 'BASAH');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.time}</td><td>${h.area}</td><td>${h.adc}</td><td>${h.hum}%</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td><span class="valve-status ${h.valve?'v-open':'v-closed'}">${h.valve?'TERBUKA':'TERTUTUP'}</span></td>
      <td>${h.mode}</td>`;
    body.appendChild(tr);
  });
}

// Buka / Tutup modal "Lihat Semua"
function openHistoryModal(){
  historyModalOpen = true;
  const modal = document.getElementById('historyModal');
  if(modal) modal.classList.add('open');
  renderHistoryModal();
}
function closeHistoryModal(){
  historyModalOpen = false;
  const modal = document.getElementById('historyModal');
  if(modal) modal.classList.remove('open');
}

// ==========================================
// CONFIG CHART.JS
// ==========================================
const ctxEl = document.getElementById('chart');
let chart;
if(ctxEl) {
  const ctx = ctxEl.getContext('2d');
  chart = new Chart(ctx, {
    type:'line',
    data:{
      labels: chartData.labels,
      datasets:[
        {label:'Area 1 (Sensor 1)', data:chartData.series[0], borderColor:'#16a34a', backgroundColor:'rgba(22, 163, 74, 0.1)', tension:.3, pointRadius:3, fill:false},
        {label:'Area 2 (Sensor 2)', data:chartData.series[1], borderColor:'#f59e0b', backgroundColor:'rgba(245, 158, 11, 0.1)', tension:.3, pointRadius:3, fill:false},
        {label:'Area 3 (Sensor 3)', data:chartData.series[2], borderColor:'#8b5cf6', backgroundColor:'rgba(139, 92, 246, 0.1)', tension:.3, pointRadius:3, fill:false},
        {label:'Area 4 (Sensor 4)', data:chartData.series[3], borderColor:'#2563eb', backgroundColor:'rgba(37, 99, 235, 0.1)', tension:.3, pointRadius:3, fill:false},
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ y:{ min:0, max:100, title:{display:true,text:'Kelembapan (%)'} } },
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12 } } }
    }
  });
}

// Menambahkan Titik Data Baru ke Grafik
function pushChartPoint(){
  if(!chart) return;
  const label = fmtTime(new Date());
  chartData.labels.push(label);
  areas.forEach((a,i)=> chartData.series[i].push(a.hum));
  if(chartData.labels.length > 10){
    chartData.labels.shift();
    chartData.series.forEach(s=>s.shift());
  }
  chart.update();
}

// ==========================================
// KONTROL AKSI & KIRIM KE FIREBASE
// ==========================================
function sendFirebaseCommand(cmdObj) {
  const dbRef = ref(db, '/');

  if (cmdObj.command === "SET_MODE") {
    update(dbRef, { mode: cmdObj.value.toUpperCase() });
  }
  else if (cmdObj.command === "TOGGLE_VALVE") {
    const areaKey = `area_${cmdObj.areaIndex + 1}`;
    const updates = {};
    updates[`${areaKey}/valve`] = cmdObj.value === "true";
    update(dbRef, updates);
  }
  else if (cmdObj.command === "RESET_SYSTEM") {
    update(dbRef, { command_trigger: "RESET" });
  }
}

function setMode(m){
  mode = m;
  document.getElementById('btnAuto').classList.toggle('inactive', m!=='auto');
  document.getElementById('btnManual').classList.toggle('active', m==='manual');
  document.getElementById('sidePanel').classList.toggle('open', m==='manual');
  sendFirebaseCommand({ command: "SET_MODE", value: m, areaIndex: -1 });
  if(m==='manual') renderSidePanel();
  renderAreas();
}

function renderSidePanel(){
  const sel = document.getElementById('areaSelect');
  if(sel && sel.options.length === 0){
    areas.forEach((a,i)=>{
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = `Valve Area ${i+1}`;
      sel.appendChild(opt);
    });
  }
  if(sel) selectedArea = parseInt(sel.value || selectedArea);

  const a = areas[selectedArea];
  const s = soilStatus(a.status);

  document.getElementById('sideAdc').textContent = a.adc;
  document.getElementById('sideHum').textContent = a.hum + '%';
  document.getElementById('sideSoil').innerHTML = `<span class="badge ${s.cls}">${s.label}</span>`;
  document.getElementById('sideValve').textContent = a.valve ? 'TERBUKA' : 'TERTUTUP';
  document.getElementById('sideValve').style.color = a.valve ? 'var(--green)' : 'var(--red)';
  document.getElementById('valveToggle').checked = a.valve;
}

function toggleValve(){
  const checked = document.getElementById('valveToggle').checked;
  areas[selectedArea].valve = checked;
  sendFirebaseCommand({ command: "TOGGLE_VALVE", areaIndex: selectedArea, value: checked ? "true" : "false" });
  renderSidePanel();
  renderAreas();
}

// Reset Grafik, Riwayat, dan Mode ke AUTO Lokal
function resetSystem(){
  sendFirebaseCommand({ command: "RESET_SYSTEM", value: "restart", areaIndex: -1 });

  // Menghapus data lokal sementara
  history = [];

  // FIX PENTING: kosongkan array DI TEMPAT (length = 0), JANGAN buat objek/array baru.
  // Chart.js menyimpan referensi ke chartData.series[i] saat chart dibuat pertama kali.
  // Kalau kita ganti dengan array baru di sini, chart akan "putus koneksi" dan
  // berhenti ter-update selamanya walau data sensor terus masuk dari Firebase.
  chartData.labels.length = 0;
  chartData.series.forEach(s => s.length = 0);
  if(chart) {
    chart.update();
  }

  setMode('auto');
  renderHistory();
  alert("Grafik Lokal Reset. Perintah reset dikirim lewat Cloud Firebase.");
}

// ==========================================
// EXPORT RIWAYAT DATA KE EXCEL (.xlsx)
// ==========================================
function exportHistoryToExcel(){
  if (typeof XLSX === 'undefined') {
    alert('Library export Excel belum termuat. Pastikan koneksi internet aktif lalu coba lagi.');
    return;
  }
  if (history.length === 0) {
    alert('Belum ada data riwayat untuk diexport.');
    return;
  }

  // Export seluruh riwayat yang tersimpan (bukan cuma 8 baris yang tampil di tabel)
  const rows = history.map(h => ({
    'Waktu': h.time,
    'Area': h.area,
    'ADC': h.adc,
    'Kelembapan (%)': h.hum,
    'Status Tanah': h.hum < 30 ? 'Kering' : (h.hum <= 60 ? 'Lembap' : 'Basah'),
    'Status Valve': h.valve ? 'TERBUKA' : 'TERTUTUP',
    'Mode': h.mode
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [ {wch:12}, {wch:10}, {wch:8}, {wch:14}, {wch:14}, {wch:14}, {wch:10} ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Riwayat Kelembapan');

  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `riwayat_kelembapan_${stamp}.xlsx`);
}

// Mengekspos Fungsi ke Global Agar Bisa Dipanggil di index.html
window.setMode = setMode;
window.toggleValve = toggleValve;
window.resetSystem = resetSystem;
window.renderSidePanel = renderSidePanel;
window.exportHistoryToExcel = exportHistoryToExcel;
window.openHistoryModal = openHistoryModal;
window.closeHistoryModal = closeHistoryModal;

// ==========================================
// LISTEN DATA DARI FIREBASE SECARA REALTIME
// ==========================================
onValue(ref(db, '/'), (snapshot) => {
  const data = snapshot.val();
  if (data) {
    handleRealtimeDataFromFirebase(data);
  }
});

// Render Awal Secara Lokal Sebelum Data Firebase Masuk
renderAreas();
renderHistory();
