// crash-detector.js - Detección Híbrida de Caídas (DeviceMotion + GPS) para BiciLog v0.0.5

const SPIKE_THRESHOLD_G = 4.0;       // > 4G se considera impacto
const STILL_SPEED_KMH = 1.0;         // velocidad <= 1 km/h = detenido
const STILL_DURATION_MS = 5000;      // 5 segundos de reposo post-impacto
const RESTING_G_LOW = 0.8;           // gravedad en reposo (~1G con margen)
const RESTING_G_HIGH = 1.2;

export const CrashDetector = {
  isActive: false,
  lastSpikeTime: 0,
  spikeDetected: false,
  currentSpeedKmh: 0,
  onCrashTrigger: null,   // callback cuando se dispara el SOS
  motionListener: null,

  async requestPermission() {
    if (typeof DeviceMotionEvent === 'undefined') {
      console.warn('[Crash] DeviceMotion no soportado.');
      return false;
    }
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        return perm === 'granted';
      } catch (e) {
        console.warn('[Crash] Permiso DeviceMotion denegado:', e);
        return false;
      }
    }
    return true; // Android no requiere permiso explícito
  },

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.spikeDetected = false;
    this.lastSpikeTime = 0;

    this.motionListener = (event) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;
      const totalG = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2) / 9.81;
      this._processAcceleration(totalG);
    };

    window.addEventListener('devicemotion', this.motionListener);
    console.log('[Crash] Detector de caídas activado.');
  },

  stop() {
    this.isActive = false;
    this.spikeDetected = false;
    if (this.motionListener) {
      window.removeEventListener('devicemotion', this.motionListener);
      this.motionListener = null;
    }
    console.log('[Crash] Detector de caídas detenido.');
  },

  updateSpeed(kmh) {
    this.currentSpeedKmh = kmh || 0;
    this._checkStillCondition();
  },

  _processAcceleration(totalG) {
    if (!this.isActive) return;
    if (totalG > SPIKE_THRESHOLD_G && !this.spikeDetected) {
      this.spikeDetected = true;
      this.lastSpikeTime = Date.now();
      console.warn(`[Crash] IMPACTO DETECTADO: ${totalG.toFixed(1)}G a ${this.currentSpeedKmh.toFixed(1)} km/h`);
      this._checkStillCondition();
    }
  },

  _checkStillCondition() {
    if (!this.spikeDetected || !this.lastSpikeTime) return;
    const elapsed = Date.now() - this.lastSpikeTime;
    if (elapsed < STILL_DURATION_MS) return;

    const isStill = this.currentSpeedKmh <= STILL_SPEED_KMH;
    if (isStill) {
      console.warn('[Crash] SOS: impacto + 5s detenido. Disparando secuencia de emergencia.');
      this.spikeDetected = false;
      this.lastSpikeTime = 0;
      if (this.onCrashTrigger) this.onCrashTrigger();
    } else {
      // Se movió tras el impacto → falsa alarma (ej. bache)
      console.log('[Crash] Falsa alarma: ciclista en movimiento post-impacto.');
      this.spikeDetected = false;
      this.lastSpikeTime = 0;
    }
  }
};
