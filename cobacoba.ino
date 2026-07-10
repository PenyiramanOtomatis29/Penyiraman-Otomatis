#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>

// Menyediakan token dan helper manajemen data Firebase [cite: 1]
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// =========================================================================
// 1. KREDENSIAL WIFI & FIREBASE (!!! WAJIB SESUAIKAN DENGAN MILIKMU !!!)
// =========================================================================
#define WIFI_SSID "Kost 44_plus"                 // Ganti dengan nama WiFi/Hotspot Anda
#define WIFI_PASSWORD "101145timun"           // Ganti dengan password WiFi Anda

// Kredensial Firebase (Dapat dari Console Firebase -> Project Settings)
#define API_KEY "AIzaSyDhoFPppidsW_oxPHbCteZO2_SPdLSnwtA"
#define DATABASE_URL "https://penyiraman-otomatis-2728b-default-rtdb.asia-southeast1.firebasedatabase.app"

// Variabel manajemen data Firebase [cite: 1]
FirebaseData fbdoWrite;
FirebaseAuth auth;
FirebaseConfig config;

// =========================================================================
// 2. DEFINISI PIN HARDWARE (Active LOW Relay) [cite: 1]
// =========================================================================
// Pin ADC untuk 4 Sensor Kelembapan Tanah (Sesuai dengan image_0.png)
const int SENSOR_1_PIN   = 4;
const int SENSOR_2_PIN   = 5;
const int SENSOR_3_PIN   = 6;
const int SENSOR_4_PIN   = 7;

// Pin Relay untuk 4 Solenoid Valve [cite: 1]
const int VALVE_1_PIN    = 16;
const int VALVE_2_PIN    = 17;
const int VALVE_3_PIN    = 18;
const int VALVE_4_PIN    = 8;

// Pin Relay untuk Pompa Utama [cite: 1]
const int PUMP_RELAY_PIN = 15;

// Pin Custom I2C untuk LCD pada ESP32-S3 [cite: 1]
const int LCD_SDA_PIN    = 9;
const int LCD_SCL_PIN    = 10;

LiquidCrystal_I2C lcd(0x27, 20, 4);

// =========================================================================
// 3. STATE VARIABEL GLOBAL & KALIBRASI
// ========================================== [cite: 1]
bool isAutoMode = true;             // Default: Mode AUTO
int adcValues[4] = {0, 0, 0, 0};    // Nilai mentah ADC dari sensor
int soilPercentages[4] = {0, 0, 0, 0}; // Hasil konversi ADC ke % Kelembapan
bool valveStates[4] = {false, false, false, false}; // Status valve (Open/Close)
bool pumpState = false;             // Status pompa utama (ON/OFF)

// --- KALIBRASI NILAI ADC SENSOR ---
// Sesuai data real di image_0.png, sensor terbaca ~700-800.
// Gunakan range ini agar persentase kelembapan bisa bergerak dinamis [cite: image_0.png].
const int ADC_DRY = 4095;           // Nilai saat sensor benar-benar kering [cite: 16]
const int ADC_WET = 500;            // Nilai saat sensor benar-benar basah [cite: 16]

// Timing variabel [cite: 1]
unsigned long prevMillisSensor = 0;
unsigned long prevMillisLCD = 0;
int lcdPageIdx = 0;

// Prototip Fungsi [cite: 19]
void readSensors();
void executeControlLogic();
void printSerialMonitor();
void updateLCD();
void uploadAndSyncFirebase();

void setup() {
    Serial.begin(115200);
    delay(1000);

    // --- Inisialisasi LCD I2C --- [cite: 20]
    Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
    lcd.init();
    lcd.backlight();
    lcd.setCursor(0, 0);
    lcd.print("Smart Watering");
    lcd.setCursor(0, 1);
    lcd.print("System...");
    delay(1500);

    // --- Melakukan Koneksi ke Wi-Fi --- [cite: 20]
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Koneksi WiFi...");
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WiFi] Menghubungkan ke "); Serial.println(WIFI_SSID);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\n[WiFi] Sukses Terhubung!");
    lcd.setCursor(0, 1);
    lcd.print("Sukses! IP:");
    lcd.print(WiFi.localIP());
    delay(2000);

    // --- Konfigurasi Firebase --- [cite: 24]
    lcd.clear();
    lcd.print("Koneksi Firebase");
    config.database_url = DATABASE_URL;
    config.api_key = API_KEY;
    
    // User Anonim untuk penyederhanaan akses [cite: 24]
    auth.user.email = "";
    auth.user.password = "";

    Firebase.reconnectWiFi(true);
    Firebase.begin(&config, &auth);
    delay(1000);

    // --- Pengaturan Pin Mode --- [cite: 25]
    pinMode(SENSOR_1_PIN, INPUT);
    pinMode(SENSOR_2_PIN, INPUT);
    pinMode(SENSOR_3_PIN, INPUT);
    pinMode(SENSOR_4_PIN, INPUT);

    pinMode(VALVE_1_PIN, OUTPUT);
    pinMode(VALVE_2_PIN, OUTPUT);
    pinMode(VALVE_3_PIN, OUTPUT);
    pinMode(VALVE_4_PIN, OUTPUT);
    pinMode(PUMP_RELAY_PIN, OUTPUT);

    // Set Kondisi Awal: Semua MATI (Active LOW Relay = Sinyal HIGH artinya MATI) [cite: 25]
    digitalWrite(VALVE_1_PIN, HIGH);
    digitalWrite(VALVE_2_PIN, HIGH);
    digitalWrite(VALVE_3_PIN, HIGH);
    digitalWrite(VALVE_4_PIN, HIGH);
    digitalWrite(PUMP_RELAY_PIN, HIGH);
    
    lcd.clear();
    lcd.print("Sistem Dimulai!");
    delay(1000);
}

void loop() {
    unsigned long currentMillis = millis();

    // Jalankan Sinkronisasi Firebase & Pembacaan Sensor Setiap 2 Detik [cite: 28]
    if (currentMillis - prevMillisSensor >= 2000) {
        prevMillisSensor = currentMillis;
        readSensors();              // 1. Baca Sensor & Hitung Logika Auto [cite: 28]
        uploadAndSyncFirebase();    // 2. Sinkron Dua Arah dengan Cloud [cite: 28]
        executeControlLogic();      // 3. Kontrol Relay Fisik [cite: 28]
        printSerialMonitor();       // 4. Debugging ke Serial [cite: 28]
    }

    // Pergantian Halaman Tampilan LCD Setiap 2 Detik [cite: 28]
    if (currentMillis - prevMillisLCD >= 2000) {
        prevMillisLCD = currentMillis;
        updateLCD();
        lcdPageIdx = (lcdPageIdx + 1) % 3; // Total 3 halaman [cite: 28]
    }
}

// 1. Fungsi Pembacaan Sensor & Logika Auto [cite: 30]
void readSensors() {
    // Membaca Nilai ADC Mentah [cite: 30]
    adcValues[0] = analogRead(SENSOR_1_PIN);
    adcValues[1] = analogRead(SENSOR_2_PIN);
    adcValues[2] = analogRead(SENSOR_3_PIN);
    adcValues[3] = analogRead(SENSOR_4_PIN);

    // Konversi ADC ke Persentase Kelembapan (0% - 100%)
    for (int i = 0; i < 4; i++) {
        // Pemetaan nilai ADC ke Persentase (0% - 100%) [cite: 31]
        int pct = map(adcValues[i], ADC_DRY, ADC_WET, 0, 100);
        
        // Batasi hasil konversi agar tidak kurang dari 0% atau lebih dari 100% [cite: 32]
        soilPercentages[i] = constrain(pct, 0, 100);

        // --- Logika Kontrol Otomatis (Hanya berjalan di MODE AUTO) --- [cite: 32]
        if (isAutoMode) {
            // JIKA Kelembapan rendah (<= 30%): Buka Kran/Valve (True) [cite: 33]
            if (soilPercentages[i] <= 30) {
                valveStates[i] = true;   
            } 
            // JIKA Kelembapan cukup (>= 60%): Tutup Kran/Valve (False) [cite: 33, 34]
            else if (soilPercentages[i] >= 60) {
                valveStates[i] = false;  
            }
        }
    }
}

// 2. Fungsi Sinkronisasi Firebase Dua Arah [cite: 1, 18, 34, 40]
void uploadAndSyncFirebase() {
    if (Firebase.ready()) {
        
        // =========================================================================
        // BAGIAN 1: AMBIL PERINTAH DARI WEBSITE (WEB PULL) [cite: 1]
        // =========================================================================
        // Tarik data root ("/") untuk mendapatkan 'mode' dan status 'valve' sekaligus [cite: 34]
        if (Firebase.RTDB.getJSON(&fbdoWrite, "/")) {
            FirebaseJsonData jsonData;

            // A. Ambil Perintah Mode Sistem (AUTO / MANUAL) [cite: 35]
            fbdoWrite.jsonObject().get(jsonData, "mode");
            if (jsonData.success) {
                String valMode = jsonData.stringValue;
                // Update variabel mode lokal ESP32 [cite: 35]
                isAutoMode = (valMode == "AUTO");
            }
            
            // B. Jika di Web disetel ke MANUAL, tarik status tombol valve dari web [cite: 37]
            if (!isAutoMode) {
                // Perbarui status valve lokal berdasarkan data perintah dari Firebase [cite: 37]
                fbdoWrite.jsonObject().get(jsonData, "area_1/valve");
                if (jsonData.success) valveStates[0] = jsonData.boolValue;
                
                fbdoWrite.jsonObject().get(jsonData, "area_2/valve");
                if (jsonData.success) valveStates[1] = jsonData.boolValue;
                
                fbdoWrite.jsonObject().get(jsonData, "area_3/valve");
                if (jsonData.success) valveStates[2] = jsonData.boolValue;

                fbdoWrite.jsonObject().get(jsonData, "area_4/valve");
                if (jsonData.success) valveStates[3] = jsonData.boolValue;
            }
        }

        // =========================================================================
        // BAGIAN 2: UNGGAH DATA REALTIME SENSOR KE FIREBASE (PUSH) [cite: 1]
        // =========================================================================
        FirebaseJson jsonWrite;
        String statusTanah[4];
        
        // Tentukan Kategori Tanah Berdasarkan Kelembapan (%) [cite: 1]
        for(int i = 0; i < 4; i++){
            if(soilPercentages[i] < 30) statusTanah[i] = "KERING";
            else if(soilPercentages[i] <= 60) statusTanah[i] = "LEMBAB";
            else statusTanah[i] = "BASAH";
        }

        // --- Susun Paket JSON Data Realtime [cite: 1] ---
        
        // PERBAIKAN: Hanya push data mode jika dalam kondisi AUTO, agar tidak balapan data [cite: 1]
        if (isAutoMode) {
            jsonWrite.set("mode", "AUTO");
        }

        // Data Area 1 [cite: 1]
        jsonWrite.set("area_1/adc", adcValues[0]);
        jsonWrite.set("area_1/humidity", soilPercentages[0]);
        jsonWrite.set("area_1/status", statusTanah[0]);
        // Dalam mode AUTO, status kran di Firebase mengikuti ESP. Dalam MANUAL, mengikuti perintah Web [cite: 1]
        if (isAutoMode) jsonWrite.set("area_1/valve", valveStates[0]);

        // Data Area 2 [cite: 1]
        jsonWrite.set("area_2/adc", adcValues[1]);
        jsonWrite.set("area_2/humidity", soilPercentages[1]);
        jsonWrite.set("area_2/status", statusTanah[1]);
        if (isAutoMode) jsonWrite.set("area_2/valve", valveStates[2]); 

        // Data Area 3 [cite: 1]
        jsonWrite.set("area_3/adc", adcValues[2]);
        jsonWrite.set("area_3/humidity", soilPercentages[2]);
        jsonWrite.set("area_3/status", statusTanah[2]);
        if (isAutoMode) jsonWrite.set("area_3/valve", valveStates[2]);

        // Data Area 4 [cite: 1]
        jsonWrite.set("area_4/adc", adcValues[3]);
        jsonWrite.set("area_4/humidity", soilPercentages[3]);
        jsonWrite.set("area_4/status", statusTanah[3]);
        if (isAutoMode) jsonWrite.set("area_4/valve", valveStates[3]);

        // Kirim pembaruan data sensor ke Firebase root ("/") sekaligus agar hemat kuota [cite: 1]
        Firebase.RTDB.updateNode(&fbdoWrite, "/", &jsonWrite);
    }
}

// 3. Fungsi Kontrol Hardware Fisik [cite: 18]
void executeControlLogic() {
    // Kontrol Relay Valve (Active LOW: LOW = Hidup, HIGH = Mati) [cite: 47]
    digitalWrite(VALVE_1_PIN, valveStates[0] ? LOW : HIGH);
    digitalWrite(VALVE_2_PIN, valveStates[1] ? LOW : HIGH);
    digitalWrite(VALVE_3_PIN, valveStates[2] ? LOW : HIGH);
    digitalWrite(VALVE_4_PIN, valveStates[3] ? LOW : HIGH);

    // Kontrol Pompa Utama: Hidup JIKA ada minimal satu valve yang TERBUKA [cite: 49]
    pumpState = (valveStates[0] || valveStates[1] || valveStates[2] || valveStates[3]);
    digitalWrite(PUMP_RELAY_PIN, pumpState ? LOW : HIGH);
}

// 4. Fungsi Debugging ke Serial Monitor [cite: 1]
void printSerialMonitor() {
    Serial.println("\n--- [cite: Smart Watering Debug] ---");
    Serial.print("WiFi IP  : "); Serial.println(WiFi.localIP());
    Serial.print("Mode     : "); Serial.println(isAutoMode ? "AUTO" : "MANUAL");
    Serial.print("Pompa    : "); Serial.println(pumpState ? "ON (POMPA HIDUP)" : "OFF");
    Serial.println("----------------------------------------");
    
    for (int i = 0; i < 4; i++) {
        Serial.print("Area "); Serial.print(i + 1);
        Serial.print(" | ADC: "); Serial.print(adcValues[i]);
        Serial.print(" | Kelembapan: "); Serial.print(soilPercentages[i]);
        Serial.print("% | Valve: ");
        Serial.println(valveStates[i] ? "BUKA (Menyiram)" : "TUTUP");
    }
    Serial.println("----------------------------------------");
}

// 5. Fungsi Tampilan LCD 20x4 [cite: 1]
void updateLCD() {
    lcd.clear();
    switch (lcdPageIdx) {
        case 0:
            // Halaman 1: Area 1 & 2
            lcd.setCursor(0, 0);
            lcd.print("S1:"); lcd.print(soilPercentages[0]); lcd.print("% V1:"); lcd.print(valveStates[0]?"ON ":"OFF");
            lcd.setCursor(0, 1); 
            lcd.print("S2:"); lcd.print(soilPercentages[1]); lcd.print("% V2:"); lcd.print(valveStates[1]?"ON ":"OFF");
            break;
        case 1:
            // Halaman 2: Area 3 & 4
            lcd.setCursor(0, 0);
            lcd.print("S3:"); lcd.print(soilPercentages[2]); lcd.print("% V3:");
            lcd.print(valveStates[2]?"ON ":"OFF");
            lcd.setCursor(0, 1); 
            lcd.print("S4:"); lcd.print(soilPercentages[3]); lcd.print("% V4:"); lcd.print(valveStates[3]?"ON ":"OFF");
            break;
        case 2:
            // Halaman 3: Status Pompa, WiFi, Mode
            lcd.setCursor(0, 0);
            lcd.print("POMPA U: ");
            lcd.print(pumpState ? "HIDUP (ON)" : "MATI (OFF)");
            
            lcd.setCursor(0, 1); 
            lcd.print("MODE : "); lcd.print(isAutoMode ? "OTOMATIS (A)" : "MANUAL (M)");
            
            lcd.setCursor(0, 2); 
            lcd.print("WIFI : ");
            lcd.print(WiFi.status() == WL_CONNECTED ? "TERHUBUNG" : "TERPUTUS");
            break;
    }
}