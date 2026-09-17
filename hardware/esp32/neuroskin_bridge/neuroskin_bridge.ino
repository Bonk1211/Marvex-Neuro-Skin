// NeuroSkin ESP32 bridge: 4 x BH1750 on three I2C buses + PCA9685 servos.
// Posts lux readings to the FastAPI backend each tick and applies the louvre
// angles it returns. Wiring and pulse values match the verified circuit test.

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <BH1750.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>

// Network: WiFi, backend URL and token live in gitignored secrets.h (copy secrets.h.example).
#include "secrets.h"

// ---------------- Wiring (matches the 3-bus circuit test) ----------------
#define SDA_BUS1 21  // hardware: PCA9685 + BH1750 #1
#define SCL_BUS1 22
#define SDA_BUS2 32  // hardware: BH1750 #3 + #4
#define SCL_BUS2 33
#define SDA_BUS3 25  // software (bit-banged): BH1750 #2 only
#define SCL_BUS3 26
#define I2C_HZ 50000 // hardware buses, slowed for breadboard wiring

TwoWire I2C_BUS1 = TwoWire(0);
TwoWire I2C_BUS2 = TwoWire(1);
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40, I2C_BUS1);

// ---------------- Calibration knobs ----------------
// PCA9685 ticks at 50 Hz for servo 0 and 180 degrees (~1000/2000 us), from the circuit test.
#define SERVO_MIN 205
#define SERVO_MAX 410
// Nominal 25 MHz; real PCA9685 oscillators run a few percent off. Measure a pulse and tune.
#define PCA9685_OSC_HZ 25000000
#define LOUVRE_MAX_DEG 180.0f  // louvre 0 = perpendicular, 90 = parallel, 180 = perpendicular flipped
#define SAFE_ANGLE_DEG 0.0f    // start and backend-silent position: perpendicular
#define MAX_STEP_DEG 10.0f     // slew per tick: spares the linkages and the servo supply
#define TICK_MS 500
#define HTTP_TIMEOUT_MS 400
#define BACKEND_TIMEOUT_MS 3000

struct Panel {
  const char *id;    // backend panel id
  TwoWire *bus;      // nullptr = software bus 3 (GPIO25/26)
  uint8_t address;   // 0x23 ADDR->GND, 0x5C ADDR->3.3V
  uint8_t channel;   // PCA9685 output
  float servoAt0;    // servo degrees at louvre 0 (perpendicular to the facade)
  float servoAt180;  // servo degrees at louvre 180 (perpendicular, flipped); swap to reverse
};

// servoAt0/servoAt180 are boot defaults (the SG90 full travel, 1:1); every backend reply
// replaces them with the calibration set on the dashboard's /hardware page.
// ponytail: not persisted on the ESP32, so a boot without the backend uses these defaults.
Panel PANELS[4] = {
  {"bh1", &I2C_BUS1, 0x23, 4, 180, 0},  // W13: reversed, set on the rig
  {"bh2", nullptr,   0x23, 5, 0, 180},
  {"bh3", &I2C_BUS2, 0x23, 6, 0, 180},
  {"bh4", &I2C_BUS2, 0x5C, 7, 180, 0},  // W10: reversed, set on the rig
};

BH1750 sensors[4];
bool sensorOk[4];
float commanded[4];  // louvre angle last written to the PCA9685
float target[4];     // louvre angle requested by the backend (or safe)
uint32_t seq = 0;
unsigned long lastReplyMs = 0;
bool safeMode = false;

// ---------------- Software I2C bus 3 (ported from the 3-bus circuit test) ----------------
// Open-drain: LOW drives the pin, HIGH releases it. INPUT_PULLUP keeps a released line
// high when the module is unplugged, so a missing sensor NACKs instead of reading as ACK.
// ponytail: master-only, no clock stretching; BH1750 never stretches.
void line(uint8_t pin, bool high) {
  if (high) {
    pinMode(pin, INPUT_PULLUP);
  } else {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  delayMicroseconds(5);
}

void softStart() {
  line(SDA_BUS3, HIGH);
  line(SCL_BUS3, HIGH);
  line(SDA_BUS3, LOW);
  line(SCL_BUS3, LOW);
}

void softStop() {
  line(SDA_BUS3, LOW);
  line(SCL_BUS3, HIGH);
  line(SDA_BUS3, HIGH);
}

// Clocks one bit out and returns SDA sampled while SCL is high (HIGH = release to read).
bool softBit(bool high) {
  line(SDA_BUS3, high);
  line(SCL_BUS3, HIGH);
  bool level = digitalRead(SDA_BUS3);
  line(SCL_BUS3, LOW);
  return level;
}

bool softWrite(uint8_t data) {  // true when the sensor ACKs
  for (int bit = 7; bit >= 0; bit--) softBit((data >> bit) & 1);
  return !softBit(HIGH);
}

uint8_t softRead(bool ack) {
  uint8_t data = 0;
  for (int bit = 0; bit < 8; bit++) data = (data << 1) | softBit(HIGH);
  softBit(!ack);  // ACK pulls SDA low, NACK releases it
  return data;
}

bool softCommand(uint8_t address, uint8_t command) {
  softStart();
  bool ok = softWrite(address << 1) && softWrite(command);
  softStop();
  return ok;
}

// Power on, reset, continuous high resolution: the same sequence the BH1750 library sends.
bool softBegin(uint8_t address) {
  if (!softCommand(address, 0x01)) return false;
  delay(10);
  softCommand(address, 0x07);
  delay(10);
  return softCommand(address, 0x10);
}

float softLux(uint8_t address) {
  softStart();
  if (!softWrite((address << 1) | 1)) {
    softStop();
    return -1;
  }
  uint16_t raw = softRead(true) << 8;
  raw |= softRead(false);
  softStop();
  return raw / 1.2f;  // BH1750 counts to lux at the default measurement time
}

bool startSensor(int i) {
  const Panel &p = PANELS[i];
  return p.bus ? sensors[i].begin(BH1750::CONTINUOUS_HIGH_RES_MODE, p.address, p.bus)
               : softBegin(p.address);
}

// Negative means no reading; a failed sensor is restarted on the next tick.
float readLux(int i) {
  if (!sensorOk[i]) {
    sensorOk[i] = startSensor(i);
    return -1;  // first continuous measurement is not ready yet
  }
  float lux = PANELS[i].bus ? sensors[i].readLightLevel() : softLux(PANELS[i].address);
  if (lux < 0) sensorOk[i] = false;
  return lux;
}

void writeLouvre(int i, float louvre) {
  const Panel &p = PANELS[i];
  float servo = p.servoAt0 + (p.servoAt180 - p.servoAt0) * louvre / LOUVRE_MAX_DEG;
  servo = constrain(servo, 0.0f, 180.0f);
  pwm.setPWM(p.channel, 0, SERVO_MIN + (uint16_t)((SERVO_MAX - SERVO_MIN) * servo / 180.0f + 0.5f));
  commanded[i] = louvre;
}

// Sends one batch; applies the reply only if all four angles and calibrations are valid.
bool postTick(const float lux[4]) {
  JsonDocument request;
  request["seq"] = seq++;
  JsonObject panels = request["panels"].to<JsonObject>();
  for (int i = 0; i < 4; i++) {
    JsonObject panel = panels[PANELS[i].id].to<JsonObject>();
    if (lux[i] >= 0) panel["lux"] = roundf(lux[i] * 10) / 10;
    else panel["lux"] = nullptr;
    panel["commanded_angle"] = roundf(commanded[i] * 10) / 10;
  }
  String body;
  serializeJson(request, body);

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(BACKEND_TICK_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Hardware-Token", HARDWARE_TOKEN);
  int code = http.POST(body);
  String reply = code == 200 ? http.getString() : String();
  http.end();
  if (code != 200) {
    Serial.printf("tick HTTP %d %s\n", code, HTTPClient::errorToString(code).c_str());
    return false;
  }

  JsonDocument response;
  if (deserializeJson(response, reply)) return false;
  float next[4], at0[4], at180[4];
  for (int i = 0; i < 4; i++) {
    JsonVariant angle = response["panels"][PANELS[i].id]["angle"];
    JsonVariant servo0 = response["calibration"][PANELS[i].id]["servo_at_0"];
    JsonVariant servo180 = response["calibration"][PANELS[i].id]["servo_at_180"];
    if (!angle.is<float>() || !servo0.is<float>() || !servo180.is<float>()) return false;
    next[i] = angle.as<float>();
    at0[i] = servo0.as<float>();
    at180[i] = servo180.as<float>();
    // Comparisons also reject NaN.
    if (!(next[i] >= 0 && next[i] <= LOUVRE_MAX_DEG)) return false;
    if (!(at0[i] >= 0 && at0[i] <= 180 && at180[i] >= 0 && at180[i] <= 180)) return false;
  }
  for (int i = 0; i < 4; i++) {
    target[i] = next[i];
    if (at0[i] != PANELS[i].servoAt0 || at180[i] != PANELS[i].servoAt180) {
      PANELS[i].servoAt0 = at0[i];
      PANELS[i].servoAt180 = at180[i];
      writeLouvre(i, commanded[i]);  // re-seat now: the slew loop only writes on angle changes
    }
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  I2C_BUS1.begin(SDA_BUS1, SCL_BUS1, I2C_HZ);
  I2C_BUS2.begin(SDA_BUS2, SCL_BUS2, I2C_HZ);

  if (!pwm.begin()) Serial.println("PCA9685 FAILED");
  pwm.setOscillatorFrequency(PCA9685_OSC_HZ);  // after begin, before setPWMFreq
  pwm.setPWMFreq(50);

  for (int i = 0; i < 4; i++) {
    sensorOk[i] = startSensor(i);
    Serial.printf("%s 0x%02X: %s\n", PANELS[i].id, PANELS[i].address, sensorOk[i] ? "OK" : "FAILED");
    target[i] = SAFE_ANGLE_DEG;
    writeLouvre(i, SAFE_ANGLE_DEG);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep adds 100+ ms to every request
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastReplyMs = millis();
}

void loop() {
  unsigned long started = millis();

  float lux[4];
  for (int i = 0; i < 4; i++) lux[i] = readLux(i);

  if (WiFi.status() == WL_CONNECTED && postTick(lux)) {
    lastReplyMs = millis();
    if (safeMode) Serial.println("Backend back: applying its angles");
    safeMode = false;
  } else if (millis() - lastReplyMs > BACKEND_TIMEOUT_MS) {
    if (!safeMode) Serial.println("Backend silent: moving to safe angle");
    safeMode = true;
    for (int i = 0; i < 4; i++) target[i] = SAFE_ANGLE_DEG;
  }

  for (int i = 0; i < 4; i++) {
    float step = constrain(target[i] - commanded[i], -MAX_STEP_DEG, MAX_STEP_DEG);
    if (fabs(step) >= 0.1f) writeLouvre(i, commanded[i] + step);
  }

  unsigned long elapsed = millis() - started;
  if (elapsed < TICK_MS) delay(TICK_MS - elapsed);  // delay yields to the WiFi task
}
