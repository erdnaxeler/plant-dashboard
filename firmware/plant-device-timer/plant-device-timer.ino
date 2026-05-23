#include <Arduino.h>
#include <stdarg.h>
#include <WiFi.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <HTTPClient.h>
#include <ESPAsyncWebServer.h>
#include <WebSerial.h>
#include <ArduinoJson.h>
#include "esp_system.h"
#include "esp_wifi.h"
#include "secrets.h"

// =====================================================
//  Timer cluster + relay on GPIO 25.
//  Pairing options (no Arduino Pro required):
//    • Captive portal: join PlantTimer-XXXX (password plantsetup) → enter code
//    • secrets.h PAIRING_CODE_ON_BOOT
//    • USB Serial Monitor: pair 123456
// =====================================================

AsyncWebServer server(80);
DNSServer dnsServer;
Preferences prefs;

#ifndef RELAY_PIN
#define RELAY_PIN 25
#endif

const uint8_t RELAY_ON  = LOW;
const uint8_t RELAY_OFF = HIGH;

static const IPAddress AP_IP(192, 168, 4, 1);
static const IPAddress AP_NETMASK(255, 255, 255, 0);
static const char* AP_PASSWORD = "plantsetup";  // phones often hide open networks
static const char* FW_BUILD = "timer-portal-v3";

unsigned long lastHomeWifiAttemptMs = 0;

static const unsigned long MAX_CONTINUOUS_PUMP_MS = 60000UL;
static const unsigned long POLL_INTERVAL_MS = 60000UL;

static const char* PREFS_NS = "ptimer";
static const char* KEY_TOKEN = "d_token";

String deviceToken;
String apSsid;
bool hardwareFault = false;
bool captivePortalActive = false;
bool httpRoutesRegistered = false;

void stopCaptivePortal();
bool startCaptivePortal();
void pollUsbSerial();
void handleSerialLine(const String& line);

// ---------- NVS ----------

String loadTokenFromNvs() {
  prefs.begin(PREFS_NS, true);
  String t = prefs.getString(KEY_TOKEN, "");
  prefs.end();
  return t;
}

void saveTokenToNvs(const String& t) {
  prefs.begin(PREFS_NS, false);
  prefs.putString(KEY_TOKEN, t);
  prefs.end();
}

void clearTokenNvs() {
  prefs.begin(PREFS_NS, false);
  prefs.remove(KEY_TOKEN);
  prefs.end();
}

void applyTokenSources() {
  if (strlen(DEVICE_TOKEN_OVERRIDE) > 0) {
    deviceToken = String(DEVICE_TOKEN_OVERRIDE);
    saveTokenToNvs(deviceToken);
    return;
  }
  deviceToken = loadTokenFromNvs();
}

// ---------- Logging ----------

void logMsg(const String& msg) {
  Serial.println(msg);
  WebSerial.println(msg);
}

void logMsgf(const char* fmt, ...) {
  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Serial.println(buf);
  if (WiFi.status() == WL_CONNECTED) WebSerial.println(buf);
}

// ---------- HTTP API ----------

bool postPair(const char* code6) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/pair";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String body = String("{\"pairing_code\":\"") + code6 + "\"}";
  int httpCode = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("PAIR POST %d → %s\n", httpCode, resp.c_str());

  if (httpCode != 200) return false;

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, resp)) return false;
  if (!doc["ok"].as<bool>()) return false;

  const char* tok = doc["device_token"];
  if (!tok || !strlen(tok)) return false;

  deviceToken = String(tok);
  saveTokenToNvs(deviceToken);
  return true;
}

bool getTimerState(JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return false;

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/timer/state";
  http.begin(url);
  http.addHeader("Authorization", "Bearer " + deviceToken);

  int code = http.GET();
  String resp = http.getString();
  http.end();

  if (code != 200) {
    Serial.printf("timer/state %d → %s\n", code, resp.c_str());
    return false;
  }

  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.printf("timer/state JSON err %s\n", err.c_str());
    return false;
  }
  return true;
}

void postTimerComplete(float ml) {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return;

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/timer/complete";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);

  String body = String("{\"ml\":") + String(ml, 2) + "}";
  int code = http.POST(body);
  http.getString();
  http.end();
  Serial.printf("timer/complete %d ml=%.2f\n", code, ml);
}

void postTimerFaultPumpMax() {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return;

  HTTPClient http;
  String url = String(API_BASE) + "/api/device/timer/complete";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);
  http.POST("{\"fault\":\"pump_max\"}");
  http.getString();
  http.end();
}

// ---------- Pump ----------

void serviceBackgroundTasks() {
  ArduinoOTA.handle();
  WebSerial.loop();
  pollUsbSerial();
  if (captivePortalActive) dnsServer.processNextRequest();
}

void pumpForMs(unsigned long ms) {
  if (ms == 0) return;
  if (ms > MAX_CONTINUOUS_PUMP_MS) ms = MAX_CONTINUOUS_PUMP_MS;

  digitalWrite(RELAY_PIN, RELAY_ON);
  unsigned long start = millis();
  while (millis() - start < ms) {
    serviceBackgroundTasks();
    delay(10);
    if (millis() - start > MAX_CONTINUOUS_PUMP_MS) break;
  }
  digitalWrite(RELAY_PIN, RELAY_OFF);
}

float runSegments(const JsonArray& segs, float flowMlPerMin) {
  if (flowMlPerMin <= 0.1f) flowMlPerMin = 30.f;
  const float mlPerSec = flowMlPerMin / 60.0f;
  float totalMl = 0;

  for (JsonVariant v : segs) {
    unsigned long ms = v.as<unsigned long>();
    if (ms == 0) continue;

    if (ms > MAX_CONTINUOUS_PUMP_MS) {
      hardwareFault = true;
      digitalWrite(RELAY_PIN, RELAY_OFF);
      postTimerFaultPumpMax();
      return 0;
    }

    pumpForMs(ms);
    totalMl += (ms / 1000.0f) * mlPerSec;
    delay(2000);
    serviceBackgroundTasks();
  }

  return totalMl;
}

void tryPairingCodeFromSecrets() {
  if (strlen(PAIRING_CODE_ON_BOOT) < 6) return;
  if (deviceToken.length() > 0) return;

  String code = String(PAIRING_CODE_ON_BOOT);
  code.trim();
  code.toUpperCase();
  if (postPair(code.c_str())) {
    logMsg("Paired using PAIRING_CODE_ON_BOOT");
  }
}

// ---------- Captive portal ----------

static const char PORTAL_OK[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paired</title></head><body style="font-family:sans-serif;padding:1.5rem;max-width:400px;margin:auto">
<div class="ok" style="background:#e8f5e9;padding:1rem;border-radius:10px">
<h1 style="color:#1b5e30">Paired!</h1>
<p>Disconnect from <strong>PlantTimer</strong> Wi‑Fi and rejoin your home network.</p>
<p>In the app, tap <strong>Start watering</strong> when ready.</p>
</div></body></html>
)rawliteral";

static const char PORTAL_FAIL[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair failed</title></head><body style="font-family:sans-serif;padding:1.5rem;max-width:400px;margin:auto">
<div style="background:#fdecea;padding:1rem;border-radius:10px;color:#c0392b">
<h1>Pairing failed</h1>
<p>Check the code (not expired), cluster is calibrated, and home Wi‑Fi on the device works.</p>
<p><a href="/">Try again</a></p>
</div></body></html>
)rawliteral";

void sendPortalPage(AsyncWebServerRequest* request) {
  bool staOk = WiFi.status() == WL_CONNECTED;
  String html = F("<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">"
                  "<title>Plant Timer Pair</title><style>"
                  "body{font-family:-apple-system,sans-serif;background:#f5f7f5;padding:1.25rem;max-width:420px;margin:auto}"
                  "h1{color:#1b5e30;font-size:1.2rem}.box{padding:.75rem;border-radius:8px;margin-bottom:1rem;font-size:.85rem}"
                  ".ok{background:#e8f5e9;border:1px solid #c8e6c9}.bad{background:#fdecea;border:1px solid #f5c6c6;color:#c0392b}"
                  "input{width:100%;font-size:1.4rem;text-align:center;padding:.6rem;margin:.5rem 0 1rem;border:1px solid #ccc;border-radius:8px}"
                  "button{width:100%;padding:.75rem;background:#2d8a4e;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600}"
                  "</style></head><body><h1>Pair plant timer</h1>");
  if (staOk) {
    html += "<div class=box ok>Device online to server via home Wi-Fi (" +
            WiFi.localIP().toString() + ")</div>";
  } else {
    html += "<div class=box bad><b>Home Wi-Fi not connected.</b> Pairing cannot reach the server. "
            "Check SSID/password in secrets.h (must be 2.4 GHz). Device keeps trying…</div>";
  }
  html += F("<p style=font-size:.85rem;color:#666>Dashboard: calibrate cluster → Generate pairing code.</p>"
             "<form method=POST action=/pair><label>6-digit code</label>"
             "<input name=code inputmode=numeric pattern=[0-9]{6} maxlength=6 required>"
             "<button type=submit>Pair</button></form>"
             "<p style=font-size:.75rem;color:#888>Phone Wi-Fi: <b>");
  html += apSsid;
  html += F("</b> password <b>plantsetup</b></p></body></html>");
  request->send(200, "text/html", html);
}

void redirectToPortal(AsyncWebServerRequest* request) {
  request->redirect("http://192.168.4.1/");
}

String normalizePairCode(String code) {
  code.trim();
  code.toUpperCase();
  code.replace(" ", "");
  return code;
}

bool tryPairFromWeb(const String& rawCode, AsyncWebServerRequest* request) {
  String code = normalizePairCode(rawCode);
  if (code.length() < 6) {
    request->send(400, "text/plain", "Enter a 6-digit code");
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    request->send(503, "text/html",
                  "<h1>Home Wi-Fi offline</h1><p>Fix ssid/password in secrets.h "
                  "(2.4 GHz). <a href='/'>Back</a></p>");
    return false;
  }

  if (postPair(code.c_str())) {
    stopCaptivePortal();
    request->send_P(200, "text/html", PORTAL_OK);
    logMsg("Paired via captive portal.");
    return true;
  }

  request->send_P(400, "text/html", PORTAL_FAIL);
  return false;
}

void registerHttpRoutes() {
  if (httpRoutesRegistered) return;
  httpRoutesRegistered = true;

  server.on("/", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (deviceToken.length() > 0) {
      request->send(200, "text/plain",
                    "Plant timer paired. Captive portal is off.\n");
      return;
    }
    sendPortalPage(request);
  });

  server.on("/pair", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (deviceToken.length() > 0) {
      request->send(200, "text/plain", "Already paired.");
      return;
    }
    String code = request->hasParam("code", true)
                      ? request->getParam("code", true)->value()
                      : "";
    tryPairFromWeb(code, request);
  });

  const char* captiveUrls[] = {
      "/generate_204", "/gen_204",       "/hotspot-detect.html",
      "/library/test/success.html",     "/connecttest.txt",
      "/ncsi.txt",                        "/fwlink",
      "/redirect",                        "/canonical.html",
  };
  for (const char* url : captiveUrls) {
    server.on(url, HTTP_GET, redirectToPortal);
    server.on(url, HTTP_HEAD, redirectToPortal);
  }

  server.onNotFound([](AsyncWebServerRequest* request) {
    if (captivePortalActive && deviceToken.length() == 0) {
      redirectToPortal(request);
      return;
    }
    request->send(404, "text/plain", "Not found");
  });
}

bool startCaptivePortal() {
  if (deviceToken.length() > 0) {
    Serial.println("PlantTimer Wi-Fi OFF — already paired (token in flash).");
    Serial.println("  Serial:  clear  then reboot to pair again.");
    return false;
  }

  if (captivePortalActive && WiFi.softAPIP() != IPAddress(0, 0, 0, 0)) {
    return true;
  }

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  apSsid = String("PlantTimer-") + suffix;

  WiFi.persistent(false);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.mode(WIFI_AP_STA);
  delay(200);

  if (!WiFi.softAPConfig(AP_IP, AP_IP, AP_NETMASK)) {
    Serial.println("softAPConfig failed");
  }

  bool apOk = false;
  const int channels[] = {6, 1, 11, 4, 9};
  for (int ch : channels) {
    WiFi.softAPdisconnect(true);
    delay(100);
    apOk = WiFi.softAP(apSsid.c_str(), AP_PASSWORD, ch, 0, 8);
    if (apOk) break;
    delay(200);
  }

  if (!apOk) {
    Serial.println("ERROR: softAP failed — wrong board or Wi-Fi broken.");
    captivePortalActive = false;
    return false;
  }

  delay(500);
  if (!dnsServer.start(53, "*", AP_IP)) {
    Serial.println("DNS server failed to start");
  }
  captivePortalActive = true;

  Serial.println();
  Serial.println("========== PAIRING Wi-Fi (always on until paired) ==========");
  Serial.println("  Network:  " + apSsid);
  Serial.println("  Password: " + String(AP_PASSWORD));
  Serial.println("  Browser:  http://192.168.4.1");
  Serial.printf("  AP IP:    %s\n", WiFi.softAPIP().toString().c_str());
  Serial.println("============================================================");
  return true;
}

void stopCaptivePortal() {
  if (!captivePortalActive) return;
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  captivePortalActive = false;
  logMsg("Captive portal off.");
}

// ---------- Serial commands ----------

void pollUsbSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() > 0) handleSerialLine(line);
}

void handleSerialLine(const String& line) {
  String s = line;
  s.trim();
  if (s.length() == 0) return;

  if (s.startsWith("pair ") || s.startsWith("PAIR ")) {
    String code = normalizePairCode(s.substring(s.indexOf(' ') + 1));
    if (code.length() < 6) {
      logMsg("Usage: pair 123456");
      return;
    }
    if (postPair(code.c_str())) {
      stopCaptivePortal();
      logMsg("Paired OK — token saved.");
    } else {
      logMsg("Pair failed.");
    }
    return;
  }

  if (s.equalsIgnoreCase("clear")) {
    clearTokenNvs();
    deviceToken = "";
    startCaptivePortal();
    logMsg("Token cleared — captive portal restarted.");
    return;
  }

  if (s.equalsIgnoreCase("portal") || s.equalsIgnoreCase("setup")) {
    if (deviceToken.length() > 0) {
      logMsg("Already paired. Use: clear");
      return;
    }
    startCaptivePortal();
    return;
  }

  if (s.equalsIgnoreCase("status")) {
    logMsgf("build=%s token=%u portal=%d ap=%s apip=%s",
            FW_BUILD, (unsigned)deviceToken.length(), (int)captivePortalActive,
            captivePortalActive ? apSsid.c_str() : "-",
            captivePortalActive ? WiFi.softAPIP().toString().c_str() : "-");
    return;
  }

  logMsg("Commands: pair 123456 | clear | portal | status");
}

// ---------- Wi-Fi ----------

bool connectHomeWifi(bool keepPairingAp) {
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setAutoReconnect(true);

  if (!keepPairingAp) {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(true);
    delay(300);
  }

  lastHomeWifiAttemptMs = millis();
  WiFi.begin(ssid, password);
  Serial.print("Connecting home Wi-Fi (");
  Serial.print(ssid);
  Serial.print(")");

  for (int i = 0; i < 50 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
    serviceBackgroundTasks();
    if (i == 25) {
      WiFi.disconnect(false, false);
      delay(300);
      WiFi.begin(ssid, password);
    }
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Home Wi-Fi OK: " + WiFi.localIP().toString());
    return true;
  }

  Serial.println("Home Wi-Fi FAILED — check secrets.h (2.4 GHz SSID + password).");
  if (keepPairingAp) {
    Serial.println("PlantTimer AP stays on — fix Wi-Fi, then pair at http://192.168.4.1");
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n=== Plant timer %s ===\n", FW_BUILD);
  Serial.printf("RESET REASON: %d\n", (int)esp_reset_reason());

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  applyTokenSources();
  Serial.printf("Token in flash: %u bytes\n", (unsigned)deviceToken.length());

  registerHttpRoutes();
  server.begin();
  WebSerial.begin(&server);
  WebSerial.onMessage([](const String& msg) { handleSerialLine(msg); });

  const bool needsPairing = (deviceToken.length() == 0);

  if (needsPairing) {
  // AP first — never reboot if home Wi-Fi fails during pairing
    startCaptivePortal();
    connectHomeWifi(true);
  } else {
    if (!connectHomeWifi(false)) {
      Serial.println("Home Wi-Fi failed. Restart in 15s.");
      delay(15000);
      ESP.restart();
    }
  }

  ArduinoOTA.begin();
  Serial.println("OTA ready");

  tryPairingCodeFromSecrets();

  if (deviceToken.length() > 0) {
    stopCaptivePortal();
    Serial.println("Paired — PlantTimer AP off.");
  } else if (!captivePortalActive) {
    Serial.println("ERROR: Could not start PlantTimer AP.");
  }
}

void loop() {
  serviceBackgroundTasks();

  if (hardwareFault) {
    delay(2000);
    return;
  }

  if (deviceToken.length() == 0) {
    if (!captivePortalActive) startCaptivePortal();

    if (WiFi.status() != WL_CONNECTED &&
        millis() - lastHomeWifiAttemptMs > 20000) {
      lastHomeWifiAttemptMs = millis();
      Serial.println("Retrying home Wi-Fi…");
      connectHomeWifi(true);
    }
    delay(50);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastHomeWifiAttemptMs > 15000) {
      lastHomeWifiAttemptMs = millis();
      connectHomeWifi(false);
    }
    delay(2000);
    return;
  }

  DynamicJsonDocument doc(8192);
  if (!getTimerState(doc)) {
    delay(POLL_INTERVAL_MS);
    return;
  }

  bool waterDue = doc["water_due"] | false;
  const char* fault = doc["fault"];
  if (fault && String(fault) == "pump_max") {
    hardwareFault = true;
    delay(POLL_INTERVAL_MS);
    return;
  }

  float flow = doc["flow_ml_per_min_assumed"] | 30.0f;

  if (waterDue && doc["run_segments_ms"].is<JsonArray>()) {
    JsonArray segs = doc["run_segments_ms"].as<JsonArray>();
    if (segs.size() > 0) {
      Serial.printf("Watering: %u segments\n", segs.size());
      float ml = runSegments(segs, flow);
      if (!hardwareFault && ml > 0) postTimerComplete(ml);
    }
  } else {
    const char* msg = doc["status_message"];
    if (msg) Serial.println(msg);
  }

  delay(POLL_INTERVAL_MS);
}
