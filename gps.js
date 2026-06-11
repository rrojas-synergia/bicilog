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
              timestamp: position.timestamp
            }
          });
        }
      },
      (error) => {
        console.error("Error de sensor GPS nativo:", error);
        if (onError) onError(error);
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
  startFallbackTracking(settings, onPositionUpdate, onError) {
    let lastCoords = null;
    let totalDist = 0;
    
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords;
        let speed = coords.speed !== null ? coords.speed * 3.6 : 0;
        
        if (lastCoords) {
          // Fórmula Haversine simple
          const R = 6371;
          const dLat = (coords.latitude - lastCoords.latitude) * Math.PI / 180;
          const dLon = (coords.longitude - lastCoords.longitude) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lastCoords.latitude * Math.PI / 180) * Math.cos(coords.latitude * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const dist = R * c;
          
          if (dist > 0.002) {
            totalDist += dist;
          }
        }
        
        lastCoords = { latitude: coords.latitude, longitude: coords.longitude };
        
        if (onPositionUpdate) {
          onPositionUpdate({
            latitude: coords.latitude,
            longitude: coords.longitude,
            altitude: coords.altitude,
            speed: speed,
            distance: totalDist,
            ascent: 0,
            grade: 0,
            power: 0,
            climbInfo: null
          });
        }
      },
      onError,
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
};
