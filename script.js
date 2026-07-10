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
let history = [];                // Data riwayat sementara

// Struktur Data Lokal untuk 4 Area
let areas = [
  { name:'Area 1', sensor:'Sensor 1', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 2', sensor:'Sensor 2', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 3', sensor:'Sensor 3', adc:0, hum:0, valve:false, status:'LEMBAB' },
  { name:'Area 4', sensor:'Sensor 4', adc:0, hum:0, valve:false, status:'LEMBAB' },
];

// Data Struktur untuk Grafik Kelembapan (Range 0-100%)
let chartData = { labels:[], series:[[],[],[],[]] };

// ==========================================
// FUNGSI UTILITAS & UI
// ==========================================
// Memetakan Teks Status dari ESP ke Teks & Kelas CSS yang Benar
function soilStatus(statusText){
  // WARNA DIPERBAIKI MELALUI CSS (Basah=Biru/Hijau tema, Kering=Merah)
  if(statusText === 'KERING') return {label:'Kering', cls:'b-kering'}; // Menggunakan kelas CSS warna merah
  if(statusText === 'LEMBAB') return {label:'Lembap', cls:'b-lembap'}; // Menggunakan kelas CSS warna oranye
  if(statusText === 'BASAH') return {label:'Basah', cls:'b-basah'};  // Menggunakan kelas CSS warna biru
  return {label:'Error', cls:'b-kering'}; // Default ke warna merah
}

// Format Waktu Lokal
function fmtTime(d){
  return d.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', second:'2-digit'}); //
}

// Update Jam Realtime di Header
function updateClock(){
  const clockEl = document.getElementById('clock');
  if(clockEl) clockEl.textContent = fmtTime(new Date()); //
}
setInterval(updateClock, 1000);
updateClock();

// ==========================================
// LOGIKA PEMROSESAN DATA DARI FIREBASE
// ==========================================
// Menangani Paket Data JSON yang Masuk Secara Realtime
function handleRealtimeDataFromFirebase(data) {
  // A. Sinkronisasi Mode (AUTO/MANUAL)
  if (data.mode) {
    mode = (data.mode === 'AUTO') ? 'auto' : 'manual'; //
    const btnAuto = document.getElementById('btnAuto');
    const btnManual = document.getElementById('btnManual');
    const sidePanel = document.getElementById('sidePanel');
    
    // Perbarui Tampilan Tombol Mode
    if(btnAuto) btnAuto.classList.toggle('inactive', mode !== 'auto'); //
    if(btnManual) btnManual.classList.toggle('active', mode === 'manual'); //
    
    // Buka/Tutup Panel Samping untuk Mode Manual
    if(sidePanel) sidePanel.classList.toggle('open', mode === 'manual'); //
  }

  // B. Sinkronisasi Data Area 1 - 4
  for (let i = 0; i < 4; i++) {
    const areaKey = `area_${i+1}`; //
    if (data[areaKey]) {
      // Perbarui Data Lokal
      areas[i].hum = data[areaKey].humidity !== undefined ? data[areaKey].humidity : areas[i].hum; //
      areas[i].valve = data[areaKey].valve !== undefined ? data[areaKey].valve : areas[i].valve; //
      areas[i].status = data[areaKey].status || areas[i].status; //
      areas[i].adc = data[areaKey].adc !== undefined ? data[areaKey].adc : areas[i].adc; //
    }
  }

  // C. Update Riwayat & Grafik (Menambahkan Titik Data Baru)
  const t = fmtTime(new Date()); //
  // Tambah riwayat (ambil area terpilih saat ini sebagai representasi)
  history.unshift({time:t, area:areas[selectedArea].name, adc:areas[selectedArea].adc, hum:areas[selectedArea].hum, valve:areas[selectedArea].valve, mode:mode.toUpperCase()}); //

  // D. Render Ulang Semua Komponen Dashboard
  renderAreas(); //
  renderHistory(); //
  pushChartPoint(); //
  // Jika dalam Mode Manual, render panel samping
  if(mode === 'manual') renderSidePanel(); //
}

// Merender Kartu Area Secara Realtime
function renderAreas(){
  const grid = document.getElementById('areaGrid');
  if(!grid) return;
  grid.innerHTML = '';
  
  // Buat Kartu untuk Setiap Area
  areas.forEach((a, i)=>{
    const s = soilStatus(a.status); //
    const card = document.createElement('div');
    card.className = 'area-card' + (mode==='manual' && selectedArea===i ? ' selected' : ''); //
    card.onclick = () => {
      // Dalam Mode Manual, kartu bisa diklik untuk memilih area kontrol
      if(mode==='manual'){ 
        selectedArea = i; //
        document.getElementById('areaSelect').value = i; //
        renderSidePanel(); //
        renderAreas(); // Render ulang kartu untuk update efek 'selected'
      }
    };
    // Struktur HTML Kartu Area
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
      </div>`; //
    grid.appendChild(card); //
  });

  // --- PERBAIKAN LOGIKA RATA-RATA ---
  // Menghitung Rata-Rata Kelembapan Seluruh Area (Akurat)
  const totalHum = areas.reduce((s, a) => s + a.hum, 0); //
  const avg = Math.round(totalHum / areas.length); //
  document.getElementById('avgValue').textContent = avg + '%'; //

  // Hitung Kategori Rata-Rata yang Benar
  let avgCatText = 'LEMBAB'; //
  if (avg <= 30) avgCatText = 'KERING'; //
  else if (avg >= 60) avgCatText = 'BASAH'; //
  
  // Tampilkan dengan Warna yang Benar Sesuai CSS
  document.getElementById('avgCat').textContent = soilStatus(avgCatText).label.toUpperCase(); //
  // ----------------------------------

  // Update Ringkasan Dashboard
  document.getElementById('sumMode').textContent = mode.toUpperCase(); //
  document.getElementById('sumValve').textContent = areas.filter(a=>a.valve).length; //
  document.getElementById('sumTime').textContent = fmtTime(new Date()); //

  // Update Status Pompa Utama
  const pumpOn = areas.some(a=>a.valve); // Pompa hidup jika ada salah satu valve terbuka
  document.getElementById('pumpValue').textContent = pumpOn ? 'ON' : 'OFF'; //
  document.getElementById('pumpValue').style.color = pumpOn ? 'var(--green)' : 'var(--red)'; //
  document.getElementById('pumpSub').textContent = mode==='auto' ? 'Otomatis (Mengikuti Valve)' : 'Manual (Mengikuti Kontrol)'; //
}

// Merender Tabel Riwayat Data Realtime
function renderHistory(){
  const body = document.getElementById('historyBody');
  if(!body) return;
  body.innerHTML = '';
  // Tampilkan 8 Data Terakhir
  history.slice(0,8).forEach(h=>{
    // Tampilkan warna status sesuai kelembapan pada baris data tersebut
    const s = soilStatus(h.hum < 30 ? 'KERING' : h.hum <= 60 ? 'LEMBAB' : 'BASAH'); //
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.time}</td><td>${h.area}</td><td>${h.adc}</td><td>${h.hum}%</td>
      <td><span class="badge ${s.cls}">${s.label}</span></td>
      <td><span class="valve-status ${h.valve?'v-open':'v-closed'}">${h.valve?'TERBUKA':'TERTUTUP'}</span></td>
      <td>${h.mode}</td>`; //
    body.appendChild(tr); //
  });
}

// ==========================================
// CONFIG CHART.JS (Pembaruan Warna Grafik Berbeda)
// ==========================================
const ctxEl = document.getElementById('chart');
let chart;
if(ctxEl) {
  const ctx = ctxEl.getContext('2d');
  chart = new Chart(ctx, {
    type:'line',
    data:{
      labels: chartData.labels,
      // Warna Grafik Berbeda untuk 4 Area
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
  const label = fmtTime(new Date()); //
  chartData.labels.push(label); //
  areas.forEach((a,i)=> chartData.series[i].push(a.hum)); //
  // Batasi Grafik Hanya Menampilkan 10 Titik Data
  if(chartData.labels.length > 10){
    chartData.labels.shift();
    chartData.series.forEach(s=>s.shift());
  }
  chart.data.labels = chartData.labels; //
  chart.update(); //
}

// ==========================================
// KONTROL AKSI & KIRIM KE FIREBASE
// ==========================================
// Mengirim Perintah Update Data ke Root Firebase secara Realtime
function sendFirebaseCommand(cmdObj) {
  const dbRef = ref(db, '/');
  
  if (cmdObj.command === "SET_MODE") {
    // Update data mode di root: "/" { "mode": "AUTO"/"MANUAL" }
    update(dbRef, { mode: cmdObj.value.toUpperCase() }); //
  } 
  else if (cmdObj.command === "TOGGLE_VALVE") {
    // Update data status valve di path spesifik: "/area_X" { "valve": true/false }
    const areaKey = `area_${cmdObj.areaIndex + 1}`; //
    const updates = {};
    updates[`${areaKey}/valve`] = cmdObj.value === "true"; //
    update(dbRef, updates); //
  }
  else if (cmdObj.command === "RESET_SYSTEM") {
    // Perintah reset (sesuaikan logikanya jika ESP32 mendengarkan path tertentu)
    update(dbRef, { command_trigger: "RESET" }); //
  }
}

// Mengubah Mode Sistem Lokal & Update Tampilan
function setMode(m){
  mode = m;
  // Perbarui Warna Tombol
  document.getElementById('btnAuto').classList.toggle('inactive', m!=='auto'); //
  document.getElementById('btnManual').classList.toggle('active', m==='manual'); //
  
  // Buka/Tutup Panel Samping Mode Manual
  document.getElementById('sidePanel').classList.toggle('open', m==='manual'); //
