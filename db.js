// db.js - Persistencia Asíncrona Estructurada en IndexedDB para BiciLog (Offline-First)

const DB_NAME = 'BiciLogDB';
const DB_VERSION = 1;

let dbInstance = null;

export const DB = {
  // Inicializar la base de datos
  init() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Almacén de Rodadas (Rides)
        if (!db.objectStoreNames.contains('rides')) {
          const rideStore = db.createObjectStore('rides', { keyPath: 'timestamp' });
          // Índice para buscar rápidamente rodadas pendientes de sincronización
          rideStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        // 2. Almacén de Sensores del Usuario (User Sensors)
        if (!db.objectStoreNames.contains('user_sensors')) {
          db.createObjectStore('user_sensors', { keyPath: 'deviceId' });
        }

        console.log('[IndexedDB] Estructura de base de datos creada/actualizada.');
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        console.log('[IndexedDB] Conexión abierta con éxito.');
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('[IndexedDB] Error al abrir base de datos:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // --- CRUD PARA RODADAS (RIDES) ---

  async saveRide(ride) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['rides'], 'readwrite');
      const store = transaction.objectStore = transaction.objectStore('rides');
      
      // Si la rodada no tiene estado de sincronización, ponerlo en 'pending'
      if (!ride.sync_status) {
        ride.sync_status = 'pending';
      }

      const request = store.put(ride);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async getAllRides() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['rides'], 'readonly');
      const store = transaction.objectStore('rides');
      const request = store.getAll();

      request.onsuccess = () => {
        // Ordenar por timestamp descendente (más recientes primero)
        const sorted = request.result.sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async deleteRide(timestamp) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['rides'], 'readwrite');
      const store = transaction.objectStore('rides');
      const request = store.delete(timestamp);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async getPendingRides() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['rides'], 'readonly');
      const store = transaction.objectStore('rides');
      const index = store.index('sync_status');
      const request = index.getAll('pending');

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async markRideSynced(timestamp) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['rides'], 'readwrite');
      const store = transaction.objectStore('rides');
      
      // Obtener el registro primero
      const getReq = store.get(timestamp);
      getReq.onsuccess = () => {
        const ride = getReq.result;
        if (ride) {
          ride.sync_status = 'synced';
          const updateReq = store.put(ride);
          updateReq.onsuccess = () => resolve(true);
          updateReq.onerror = (e) => reject(e.target.error);
        } else {
          resolve(false);
        }
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  // --- CRUD PARA EQUIPAMIENTO / SENSORES (USER_SENSORS) ---

  async saveSensor(sensor) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['user_sensors'], 'readwrite');
      const store = transaction.objectStore('user_sensors');
      
      const sensorRecord = {
        deviceId: sensor.deviceId,
        deviceType: sensor.deviceType, // 'hr' | 'cadence'
        originalName: sensor.originalName || 'Sensor BLE',
        customName: sensor.customName || sensor.originalName || 'Sensor BLE',
        lastConnected: Date.now()
      };

      const request = store.put(sensorRecord);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async getSensor(deviceId) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['user_sensors'], 'readonly');
      const store = transaction.objectStore('user_sensors');
      const request = store.get(deviceId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async getAllSensors() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['user_sensors'], 'readonly');
      const store = transaction.objectStore('user_sensors');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  async deleteSensor(deviceId) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['user_sensors'], 'readwrite');
      const store = transaction.objectStore('user_sensors');
      const request = store.delete(deviceId);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }
};
