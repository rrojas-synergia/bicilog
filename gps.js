// gps.js - Geolocalización y métricas de movimiento en tiempo real

export const BiciGPS = {
  watchId: null,
  lastCoords: null,
  totalDistance: 0, // en KM
  totalAscent: 0, // en Metros
  lastAltitude: null,

  // Iniciar el seguimiento por GPS
  startTracking(onPositionUpdate, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(new Error("La geolocalización no está soportada en este dispositivo."));
      return;
    }

    this.reset();

    const options = {
      enableHighAccuracy: true, // Forzar GPS de alta precisión
      timeout: 5000,
      maximumAge: 0
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = position.coords;
        let speed = 0; // en km/h

        // 1. Velocidad (coords.speed viene en m/s)
        if (coords.speed !== null && coords.speed >= 0) {
          speed = coords.speed * 3.6; // Convertir m/s a km/h
        }

        // 2. Distancia (Fórmula Haversine entre coordenadas consecutivas)
        if (this.lastCoords) {
          // Filtrar coordenadas imprecisas (precisión superior a 30 metros puede ignorarse)
          if (coords.accuracy <= 30) {
            const dist = this.calculateDistance(
              this.lastCoords.latitude,
              this.lastCoords.longitude,
              coords.latitude,
              coords.longitude
            );
            
            // Solo acumular si la distancia es significativa (> 2 metros)
            if (dist > 0.002) {
              this.totalDistance += dist;
              
              // Si la velocidad del sensor es nula o inestable, usar la calculada por distancia
              if (coords.speed === null) {
                const timeDiff = (position.timestamp - this.lastCoords.timestamp) / 1000; // en segundos
                if (timeDiff > 0) {
                  speed = (dist * 3600) / timeDiff; // km/h
                }
              }
            }
          }
        }

        // 3. Ascenso total (filtrado de ruido de altitud del GPS)
        if (coords.altitude !== null) {
          if (this.lastAltitude !== null) {
            const altitudeDiff = coords.altitude - this.lastAltitude;
            
            // Acumular ascenso solo si subió y el cambio es mayor a 2 metros (para evitar el ruido del GPS)
            if (altitudeDiff > 2 && coords.altitudeAccuracy && coords.altitudeAccuracy < 15) {
              this.totalAscent += altitudeDiff;
            }
          }
          this.lastAltitude = coords.altitude;
        }

        // Actualizar coordenadas anteriores
        this.lastCoords = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          timestamp: position.timestamp
        };

        // Enviar actualización
        if (onPositionUpdate) {
          onPositionUpdate({
            latitude: coords.latitude,
            longitude: coords.longitude,
            speed: speed,
            distance: this.totalDistance,
            ascent: this.totalAscent,
            accuracy: coords.accuracy
          });
        }
      },
      (error) => {
        console.error("Error GPS:", error);
        if (onError) onError(error);
      },
      options
    );
  },

  // Detener el seguimiento GPS
  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  },

  // Limpiar contadores
  reset() {
    this.lastCoords = null;
    this.totalDistance = 0;
    this.totalAscent = 0;
    this.lastAltitude = null;
  },

  // Cálculo de distancia mediante fórmula Haversine (en KM)
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distancia en km
  },

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }
};
