// storage.js - Persistencia Local (Offline-first) para BiciLog

const STORAGE_KEYS = {
  SETTINGS: 'bicilog_settings',
  RIDES: 'bicilog_rides'
};

const DEFAULT_SETTINGS = {
  age: 30,
  weight: 70, // kg
  useAutoZones: true,
  manualZones: {
    z1: { min: 90, max: 110 },
    z2: { min: 111, max: 130 },
    z3: { min: 131, max: 150 },
    z4: { min: 151, max: 170 },
    z5: { min: 171, max: 190 }
  }
};

export const Storage = {
  // Obtener ajustes del perfil
  getSettings() {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!data) {
      this.saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error("Error al parsear ajustes:", e);
      return DEFAULT_SETTINGS;
    }
  },

  // Guardar ajustes
  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // Obtener zonas de FC basadas en ajustes
  getHRZones(settings) {
    if (settings.useAutoZones) {
      const maxHR = 220 - settings.age;
      return {
        z1: { min: Math.round(maxHR * 0.50), max: Math.round(maxHR * 0.60) },
        z2: { min: Math.round(maxHR * 0.60) + 1, max: Math.round(maxHR * 0.70) },
        z3: { min: Math.round(maxHR * 0.70) + 1, max: Math.round(maxHR * 0.80) },
        z4: { min: Math.round(maxHR * 0.80) + 1, max: Math.round(maxHR * 0.90) },
        z5: { min: Math.round(maxHR * 0.90) + 1, max: maxHR }
      };
    } else {
      return settings.manualZones;
    }
  },

  // Determinar en qué zona de FC cae una pulsación (BPM)
  getZoneForHR(hr, zones) {
    if (hr < zones.z1.min) return 0; // Fuera de zona (calentamiento muy suave)
    if (hr <= zones.z1.max) return 1;
    if (hr <= zones.z2.max) return 2;
    if (hr <= zones.z3.max) return 3;
    if (hr <= zones.z4.max) return 4;
    return 5;
  },

  // Obtener todas las rodadas guardadas
  getRides() {
    const data = localStorage.getItem(STORAGE_KEYS.RIDES);
    if (!data) return [];
    try {
      // Ordenar por fecha descendente (más recientes primero)
      return JSON.parse(data).sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error("Error al parsear rodadas:", e);
      return [];
    }
  },

  // Guardar una nueva rodada
  saveRide(ride) {
    const rides = this.getRides();
    rides.push(ride);
    localStorage.setItem(STORAGE_KEYS.RIDES, JSON.stringify(rides));
    return rides;
  },

  // Eliminar una rodada
  deleteRide(timestamp) {
    let rides = this.getRides();
    rides = rides.filter(ride => ride.timestamp !== timestamp);
    localStorage.setItem(STORAGE_KEYS.RIDES, JSON.stringify(rides));
    return rides;
  }
};
