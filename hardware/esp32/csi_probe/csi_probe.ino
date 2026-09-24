// NeuroSkin CSI probe: one ESP32 as a WiFi Channel State Information receiver.
// Step one of occupancy sensing. It answers the only question worth asking first:
// do CSI frames arrive at the injector's rate, and does a person moving in the
// room move the amplitude variance? No zone mapping and no backend POST yet.
//
// CSI arrives only on RECEIVED packets, so the room needs an illuminator. Router
// beacons are ~10 Hz, far too slow. Flood this board from the laptop instead:
//   sudo ping -i 0.01 <the IP this sketch prints>
//
// Standalone diagnostic. neuroskin_bridge now integrates CSI and streams it to
// Live CSI; use this separate sketch when isolating interference from the rig.

#include <WiFi.h>
#include <esp_wifi.h>
#include <math.h>

#include "secrets.h"  // WIFI_SSID / WIFI_PASSWORD (copy secrets.h.example)

// Count only frames from the injector once you know its MAC. All zeros accepts
// every source and reports which MAC was last seen, which is how you find it.
static const uint8_t INJECTOR_MAC[6] = {0, 0, 0, 0, 0, 0};

#define REPORT_MS 1000   // serial line cadence
#define BASELINE_WINDOWS 30  // ambient calibration windows, empty room
#define PRESENCE_K 3.0f  // live sigma over baseline sigma to call the room occupied

// ---------------- Rolling variance ----------------
struct Stats {
  uint32_t n;
  double sum;
  double sumsq;
};

static float stats_sigma(const Stats &s) {
  if (s.n < 2) return 0.0f;
  const double mean = s.sum / s.n;
  const double var = s.sumsq / s.n - mean * mean;
  return var > 0 ? sqrtf((float)var) : 0.0f;
}

// ---------------- Shared with the WiFi task ----------------
// The CSI callback runs in the WiFi task, not in loop(). It must not print,
// allocate or block, so it only folds each frame into these and loop() does the
// maths. The spinlock keeps a report from reading a half-updated window.
static portMUX_TYPE csi_mux = portMUX_INITIALIZER_UNLOCKED;
static Stats window = {0, 0, 0};
static uint32_t frames = 0;
static uint16_t subcarriers = 0;
static int8_t last_rssi = 0;
static uint8_t last_mac[6] = {0};

static bool mac_wanted(const uint8_t mac[6]) {
  bool filtering = false;
  for (int i = 0; i < 6; i++) filtering |= INJECTOR_MAC[i] != 0;
  if (!filtering) return true;
  return memcmp(mac, INJECTOR_MAC, 6) == 0;
}

static void csi_cb(void *ctx, wifi_csi_info_t *info) {
  (void)ctx;
  if (!mac_wanted(info->mac)) return;
  const int8_t *buf = info->buf;
  int len = info->len;
  if (info->first_word_invalid) {  // documented hardware limitation
    buf += 4;
    len -= 4;
  }
  if (len < 2) return;
  const int pairs = len / 2;
  uint32_t l1 = 0;
  for (int i = 0; i < pairs; i++) {
    // buf holds (imag, real) int8 pairs. ponytail: L1 magnitude, not hypot, so
    // there is no sqrt in the WiFi task. Swap to hypotf if phase ever matters.
    l1 += (uint32_t)abs(buf[2 * i]) + (uint32_t)abs(buf[2 * i + 1]);
  }
  const double amplitude = (double)l1 / pairs;
  portENTER_CRITICAL(&csi_mux);
  window.n++;
  window.sum += amplitude;
  window.sumsq += amplitude * amplitude;
  frames++;
  subcarriers = pairs;
  last_rssi = info->rx_ctrl.rssi;
  memcpy(last_mac, info->mac, 6);
  portEXIT_CRITICAL(&csi_mux);
}

// ---------------- Boot self-check ----------------
// The variance is the only non-trivial maths here, and int8 folding is easy to
// get wrong. A flat signal must read sigma 0; a +/-2 swing must read sigma 2.
static void selftest() {
  Stats flat = {0, 0, 0};
  for (int i = 0; i < 10; i++) {
    flat.n++;
    flat.sum += 5.0;
    flat.sumsq += 25.0;
  }
  Stats swing = {0, 0, 0};
  for (int i = 0; i < 10; i++) {
    const double v = (i % 2) ? 12.0 : 8.0;  // mean 10, sigma 2
    swing.n++;
    swing.sum += v;
    swing.sumsq += v * v;
  }
  const bool ok = fabsf(stats_sigma(flat)) < 1e-3f &&
                  fabsf(stats_sigma(swing) - 2.0f) < 1e-2f;
  Serial.printf("selftest %s\n", ok ? "PASS" : "FAIL: variance maths is wrong");
}

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);
  delay(300);
  selftest();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // CSI timestamps are precise only with modem sleep off, and even sampling is
  // the whole basis of the variance. Non-negotiable.
  WiFi.setSleep(false);
  Serial.print("joining ");
  Serial.print(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\nIP %s  ch %d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
  Serial.printf("illuminate it:  sudo ping -i 0.01 %s\n", WiFi.localIP().toString().c_str());

  wifi_csi_config_t cfg = {};
  cfg.lltf_en = true;
  cfg.htltf_en = true;
  cfg.stbc_htltf2_en = true;
  cfg.ltf_merge_en = true;
  cfg.channel_filter_en = true;
  cfg.manu_scale = false;
  cfg.shift = 0;
  ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
  ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(csi_cb, NULL));
  ESP_ERROR_CHECK(esp_wifi_set_csi(true));
  Serial.println("csi on. leave the room empty while it calibrates.");
}

// ---------------- Report loop ----------------
void loop() {
  static uint32_t next = 0;
  static Stats baseline = {0, 0, 0};
  if ((int32_t)(millis() - next) < 0) return;
  next = millis() + REPORT_MS;

  portENTER_CRITICAL(&csi_mux);
  const Stats w = window;
  const uint32_t f = frames;
  const uint16_t sc = subcarriers;
  const int8_t rssi = last_rssi;
  uint8_t mac[6];
  memcpy(mac, last_mac, 6);
  window = {0, 0, 0};
  frames = 0;
  portEXIT_CRITICAL(&csi_mux);

  if (f == 0) {
    Serial.println("0 frames/s -- no injector traffic, or wrong channel");
    return;
  }

  const float sigma = stats_sigma(w);
  if (baseline.n < BASELINE_WINDOWS) {
    baseline.n++;
    baseline.sum += sigma;
    Serial.printf("calibrating %lu/%d  %lu frames/s  %u sub  rssi %d  sigma %.2f\n",
                  (unsigned long)baseline.n, BASELINE_WINDOWS,
                  (unsigned long)f, sc, rssi, sigma);
    return;
  }

  const float base = (float)(baseline.sum / baseline.n);
  const bool occupied = sigma > PRESENCE_K * base;
  Serial.printf("%lu frames/s  %u sub  rssi %d  sigma %.2f  base %.2f  %s  mac %02x:%02x:%02x:%02x:%02x:%02x\n",
                (unsigned long)f, sc, rssi, sigma, base,
                occupied ? "OCCUPIED" : "empty",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}
