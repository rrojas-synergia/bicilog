// gps.js - Geolocalización y canalización con Web Worker para BiciLog

export const BiciGPS = {
  watchId: null,
  worker: null,

  // Iniciar el seguimiento por GPS canalizando los datos al Web Worker
  startTracking(settings, onPositionUpdate, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(new Error("La geolocalización no está soportada en este dispositivo."));
      return;
    }

    this.stopTracking(); // Detener cualquier instancia previa

    // 1. Inicializar el Web Worker
    try {
      this.worker = new Worker('gps-worker.js');
      
      // Enviar configuración inicial (Pesos para cálculo de Watts)
      this.worker.postMessage({
        type: 'CONFIGURE',
        data: {
          riderWeight: settings.weight || 70,
          bikeWeight: settings.bikeWeight || 10
        }
      });
      
      // Escuchar datos procesados del Worker
      this.worker.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === 'GPS_PROCESSED' && onPositionUpdate) {
          onPositionUpdate({
            latitude: data.lat,
            longitude: data.lon,
            altitude: data.alt,
            speed: data.speed,
            distance: data.distance,
            ascent: data.ascent,
            grade: data.grade,
            power: data.power,
            accuracy: data.accuracy,
            climbInfo: data.climbInfo
          });
        }
      };
    } catch (e) {
      console.error("Error al arrancar Web Worker, cayendo en procesamiento síncrono:", e);
      // Caída síncrona en caso de que los Web Workers estén bloqueados por políticas de seguridad
      this.startFallbackTracking(settings, onPositionUpdate, onError);
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0
    };

    // 2. Escuchar Geolocalización nativa y enviar al Worker
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords;
        
        if (this.worker) {
          this.worker.postMessage({
            type: 'GPS_RAW',
            data: {
              lat: coords.latitude,
              lon: coords.longitude,
              alt: coords.altitude,
              speed: coords.speed, // m/s
              timestamp: position.timestamp,
              accuracy: coords.accuracy
            }
          });
        }
      },
      (error) => {
        // Firewall GPS: el watcher NUNCA se detiene, el error se aísla
        console.warn("[GPS] Error temporal (watcher sigue activo):", error.code, error.message);
        if (onError) {
          // Notificar a la UI sin detener el flujo
          onError({ code: error.code, message: error.message });
        }
      },
      options
    );
  },

  // Detener el seguimiento y liberar recursos del Worker
  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  },

  // Caída de emergencia síncrona si no hay Web Workers disponibles
  // Incluye los mismos filtros estrictos del Worker para evitar saltos GPS
  startFallbackTracking(settings, onPositionUpdate, onError) {
    let lastValid = null;  // { lat, lon, alt, ts }
    let totalDist = 0;
    let totalAscent = 0;

    const MAX_ACCURACY_M = 60;
    const MAX_SPEED_KMH = 120;   // imposible en bicicleta
    const MIN_DIST_KM = 0.001;   // ~1 metro mínimo para acumular
    const R = 6371;

    const haversineKm = (lat1, lon1, lat2, lon2) => {
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords;
        const accuracy = coords.accuracy !== null ? coords.accuracy : 999;

        // --- Regla 1: Precisión ---
        if (accuracy > MAX_ACCURACY_M) {
          console.warn(`[GPS Fallback] Punto descartado: accuracy ${accuracy.toFixed(0)}m > ${MAX_ACCURACY_M}m`);
          return;
        }

        const hasRawSpeed = (coords.speed !== null && coords.speed !== undefined && coords.speed >= 0);

        if (!lastValid) {
          // Primer punto aceptado (calienta la línea base)
          lastValid = { lat: coords.latitude, lon: coords.longitude, alt: coords.altitude, ts: position.timestamp };
          return;
        }

        const timeDiff = (position.timestamp - lastValid.ts) / 1000;

        // --- Regla 2: Velocidad física implícita ---
        if (timeDiff > 0) {
          const segmentKm = haversineKm(lastValid.lat, lastValid.lon, coords.latitude, coords.longitude);
          const implicitSpeed = (segmentKm * 3600) / timeDiff;

          if (implicitSpeed > MAX_SPEED_KMH) {
            console.warn(`[GPS Fallback] Salto masivo descartado: velocidad implícita ${implicitSpeed.toFixed(0)} km/h`);
            return;
          }

          // Velocidad: priorizar dato nativo del GPS
          let speedKmh = hasRawSpeed ? coords.speed * 3.6 : implicitSpeed;

          // Anti-jitter: descartar micro-desplazamientos en reposo
          if (implicitSpeed < 1.5) {
            speedKmh = 0;
          } else if (segmentKm > MIN_DIST_KM) {
            totalDist += segmentKm;
          }

          // Ascenso acumulado positivo
          if (coords.altitude !== null && lastValid.alt !== null) {
            const altDiff = coords.altitude - lastValid.alt;
            if (altDiff > 0.3 && speedKmh > 1.5) totalAscent += altDiff;
          }

          // Pendiente instantánea
          let grade = 0;
          if (segmentKm > 0 && coords.altitude !== null && lastValid.alt !== null) {
            grade = ((coords.altitude - lastValid.alt) / (segmentKm * 1000)) * 100;
            grade = Math.max(-25, Math.min(25, grade));
          }

          // Potencia estimada simple (física de ciclismo)
          const totalMass = (settings.weight || 70) + (settings.bikeWeight || 10);
          const speedMs = speedKmh / 3.6;
          const angleRad = Math.atan(grade / 100);
          const fGravity = totalMass * 9.81 * Math.sin(angleRad);
          const fRolling = totalMass * 9.81 * Math.cos(angleRad) * 0.004;
          const fDrag = 0.5 * 0.32 * 1.225 * Math.pow(speedMs, 2);
          let power = (fGravity + fRolling + fDrag) * speedMs;
          if (power < 0) power = 0;
          power = Math.round(power / 0.95);

          // Actualizar línea base
          lastValid = { lat: coords.latitude, lon: coords.longitude, alt: coords.altitude, ts: position.timestamp };

          if (onPositionUpdate) {
            onPositionUpdate({
              latitude: coords.latitude,
              longitude: coords.longitude,
              altitude: coords.altitude,
              speed: speedKmh,
              distance: totalDist,
              ascent: totalAscent,
              grade: grade,
              power: power,
              accuracy: accuracy,
              climbInfo: null
            });
          }
        }
      },
      (error) => {
        console.error("Error de sensor GPS nativo (fallback):", error);
        if (onError) onError(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      }
    );
  }
};
