#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <HTTPClient.h>
#include <ESPAsyncWebServer.h>
#include <WebSerial.h>
#include <ArduinoJson.h>
#include "esp_system.h"
#include "secrets.h"

// =====================================================
//  Credentials: edit firmware/plant-device/secrets.h
//  (copy from secrets.h.example). That file is gitignored.
// =====================================================

// =====================================================
//  Hardware & plant config
// =====================================================
AsyncWebServer server(80);

#define SENSOR_PIN 33
#define RELAY_PIN  14

const uint8_t RELAY_ON  = LOW;
const uint8_t RELAY_OFF = HIGH;

const char* PLANT_ID = "plant_001";
String PLANT_NAME = "PLANT A";

float PCT_START_WATER = 20.0f;
float PCT_STOP_WATER  = 35.0f;

static const unsigned long MAX_PUMP_RUN_MS = 120000UL;
bool pumpLockout = false;

float rawToPercent(int raw) {
  return (raw / 4095.0f) * 100.0f;
}

// =====================================================
//  API helpers
// =====================================================

void sendMoisture(float pct) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected; skipping POST");
    WebSerial.println("WiFi not connected; skipping POST");
    return;
  }

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/telemetry";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_TOKEN);

  String body = "{\"moisture\": " + String(pct, 1) +
                ", \"plant_id\": \"" + String(PLANT_ID) + "\"" +
                ", \"plant_name\": \"" + PLANT_NAME + "\"}";

  int code = http.POST(body);
  String resp = http.getString();
  Serial.printf("POST %d → %s\n", code, resp.c_str());
  WebSerial.printf("POST %d → %s\n", code, resp.c_str());
  http.end();
}

void getThresholdSettings() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected; skipping settings fetch");
    WebSerial.println("WiFi not connected; skipping settings fetch");
    return;
  }

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/settings?plant_id=" + String(PLANT_ID);
  http.begin(url);
  http.addHeader("Authorization", String("Bearer ") + API_TOKEN);

  int code = http.GET();

  if (code == 200) {
    String response = http.getString();
    Serial.printf("Settings GET %d → %s\n", code, response.c_str());
    WebSerial.printf("Settings GET %d → %s\n", code, response.c_str());

    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      float newStart = doc["start_threshold"] | PCT_START_WATER;
      float newStop  = doc["stop_threshold"]  | PCT_STOP_WATER;

      if (newStart != PCT_START_WATER || newStop != PCT_STOP_WATER) {
        PCT_START_WATER = newStart;
        PCT_STOP_WATER  = newStop;
        Serial.printf("Updated thresholds: Start=%.1f%%, Stop=%.1f%%\n",
                      PCT_START_WATER, PCT_STOP_WATER);
        WebSerial.printf("Updated thresholds: Start=%.1f%%, Stop=%.1f%%\n",
                         PCT_START_WATER, PCT_STOP_WATER);
      } else {
        Serial.println("Thresholds unchanged");
        WebSerial.println("Thresholds unchanged");
      }
    } else {
      Serial.printf("JSON parsing error: %s\n", error.c_str());
      WebSerial.printf("JSON parsing error: %s\n", error.c_str());
    }
  } else {
    Serial.printf("Settings GET failed: %d\n", code);
    WebSerial.printf("Settings GET failed: %d\n", code);
  }

  http.end();
}

// =====================================================
//  Setup & loop
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("RESET REASON: %d\n", (int)esp_reset_reason());

  pinMode(SENSOR_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(1000);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  Serial.print("Connecting Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    if (attempts == 20) {
      Serial.print("\nRetrying connection...");
      WiFi.disconnect();
      delay(1000);
      WiFi.begin(ssid, password);
    }
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWi-Fi FAILED after 20s. Check SSID/password and ensure 2.4 GHz is enabled.");
    Serial.println("Restarting in 10 seconds...");
    delay(10000);
    ESP.restart();
  }

  server.begin();
  WebSerial.begin(&server);
  WebSerial.println("WebSerial ready");

  ArduinoOTA.begin();
  Serial.println("OTA ready");
  WebSerial.println("OTA ready");

  getThresholdSettings();

  Serial.println("*** PRODUCTION MODE: 30-minute cycles ***");
  WebSerial.println("*** PRODUCTION MODE: 30-minute cycles ***");
}

void loop() {
  ArduinoOTA.handle();
  WebSerial.loop();

  Serial.println("Checking for updated thresholds...");
  WebSerial.println("Checking for updated thresholds...");
  getThresholdSettings();

  delay(30000);

  int raw = analogRead(SENSOR_PIN);
  float pct = rawToPercent(raw);

  Serial.printf("[%s] Moisture: %.1f%% (raw=%d) | Thresholds: %.1f%% - %.1f%%\n",
                PLANT_NAME.c_str(), pct, raw, PCT_START_WATER, PCT_STOP_WATER);
  WebSerial.printf("[%s] Moisture: %.1f%% (raw=%d) | Thresholds: %.1f%% - %.1f%%\n",
                   PLANT_NAME.c_str(), pct, raw, PCT_START_WATER, PCT_STOP_WATER);
  sendMoisture(pct);

  if (pct < PCT_START_WATER) {
    if (pumpLockout) {
      Serial.println("!!! PUMP LOCKOUT ACTIVE (max runtime exceeded). Manual reset required. Pump will NOT start.");
      WebSerial.println("!!! PUMP LOCKOUT ACTIVE (max runtime exceeded). Manual reset required. Pump will NOT start.");
    } else {
      Serial.printf("[%s] Soil is dry (%.1f%% < %.1f%%) → starting pump\n",
                    PLANT_NAME.c_str(), pct, PCT_START_WATER);
      WebSerial.printf("[%s] Soil is dry (%.1f%% < %.1f%%) → starting pump\n",
                       PLANT_NAME.c_str(), pct, PCT_START_WATER);

      digitalWrite(RELAY_PIN, RELAY_ON);
      unsigned long pumpStartMs = millis();

      do {
        delay(1000);

        if (millis() - pumpStartMs >= MAX_PUMP_RUN_MS) {
          digitalWrite(RELAY_PIN, RELAY_OFF);
          pumpLockout = true;
          Serial.println("!!! SAFETY SHUTOFF: pump ran 2 minutes continuously. Manual reset required.");
          WebSerial.println("!!! SAFETY SHUTOFF: pump ran 2 minutes continuously. Manual reset required.");
          sendMoisture(pct);
          break;
        }

        raw = analogRead(SENSOR_PIN);
        pct = rawToPercent(raw);

        Serial.printf("[%s] Watering... %.1f%% (target: %.1f%%) (raw=%d)\n",
                      PLANT_NAME.c_str(), pct, PCT_STOP_WATER, raw);
        WebSerial.printf("[%s] Watering... %.1f%% (target: %.1f%%) (raw=%d)\n",
                         PLANT_NAME.c_str(), pct, PCT_STOP_WATER, raw);
        sendMoisture(pct);

      } while (pct < PCT_STOP_WATER);

      if (!pumpLockout) {
        digitalWrite(RELAY_PIN, RELAY_OFF);
        Serial.printf("[%s] Pump off (%.1f%% ≥ %.1f%%)\n", PLANT_NAME.c_str(), pct, PCT_STOP_WATER);
        WebSerial.printf("[%s] Pump off (%.1f%% ≥ %.1f%%)\n", PLANT_NAME.c_str(), pct, PCT_STOP_WATER);
      }
    }
  }

  delay(1770000);
}
