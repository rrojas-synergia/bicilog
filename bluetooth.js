// bluetooth.js - Gestor BLE Avanzado (Emparejamiento, Fingerprinting y Reconexión Silenciosa)

import { DB } from './db.js';

export const BiciSensors = {
  hrDevice: null,
  cscDevice: null,
  hrServer: null,
  cscServer: null,
  hrCharacteristic: null,
  cscCharacteristic: null,

  // Estados y callbacks de reconexión
  isHrConnected: false,
  isCscConnected: false,
  isManualDisconnect: false,
  isHrReconnecting: false,
  isCscReconnecting: false,
  hrCallbacks: null,
  cscCallbacks: null,
  onStatusUpdate: null,
  onHrDisconnect: null,
  onCscDisconnect: null,

  // Variables para el cálculo de cadencia (Crank Revolutions)
  lastCrankRevolutions: -1,
  lastCrankEventTime: -1,
  cadenceBuffer: [],       // rolling average últimas 4 lecturas válidas
  lastValidCadence: null,  // último RPM válido para fallback en rollover

  // Filtro de bici: solo conectar al sensor de cadencia vinculado al perfil seleccionado
  allowedCadenceDeviceId: null,

  setBikeCadenceDevice(deviceId) {
    this.allowedCadenceDeviceId = deviceId || null;
  },

  // Verificar si Bluetooth está soportado
  checkBluetoothSupport() {
    if (!navigator.bluetooth) {
      throw new Error("iOS_UNSUPPORTED");
    }
    return true;
  },

  // Conectar sensor de Frecuencia Cardíaca (Servicio Estándar 0x180D)
  async connectHeartRate(onValue, onDisconnect) {
    try {
      this.checkBluetoothSupport();
      this.isManualDisconnect = false;

      // Anti-zombie: limpiar conexión previa si existe
      if (this.hrDevice && this.hrDevice.gatt && this.hrDevice.gatt.connected) {
        console.log('[BLE] Desconectando zombie HR previo...');
        try { this.hrDevice.gatt.disconnect(); } catch(_) {}
        await new Promise(r => setTimeout(r, 300));
      }

      console.log("[BLE] Solicitando pulsómetro con filtrado estricto GATT 0x180D...");
      this.hrDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }]
      });

      return await this.establishHrConnection(this.hrDevice, onValue, onDisconnect);
    } catch (error) {
      console.warn('[BLE] Error FC (aislado):', error.message);
      this.handleBleError(error, "Frecuencia Cardíaca");
      return null;
    }
  },

  // Conectar sensor de Cadencia (Servicio Estándar 0x1816: Cycling Speed and Cadence)
  async connectCadence(onValue, onDisconnect) {
    try {
      this.checkBluetoothSupport();
      this.isManualDisconnect = false;

      if (this.cscDevice && this.cscDevice.gatt && this.cscDevice.gatt.connected) {
        console.log('[BLE] Desconectando zombie CSC previo...');
        try { this.cscDevice.gatt.disconnect(); } catch(_) {}
        await new Promise(r => setTimeout(r, 300));
      }

      console.log("[BLE] Solicitando sensor de cadencia con filtrado estricto GATT 0x1816...");
      this.cscDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_speed_and_cadence'] }]
      });

      return await this.establishCscConnection(this.cscDevice, onValue, onDisconnect);
    } catch (error) {
      console.warn('[BLE] Error Cadencia (aislado):', error.message);
      this.handleBleError(error, "Cadencia");
      return null;
    }
  },

  // Inicializar handlers de desconexión reutilizables
  setupDisconnectListeners() {
    if (!this.onHrDisconnect) {
      this.onHrDisconnect = async (event) => {
        const device = event.target;
        this.isHrConnected = false;
        
        if (this.isManualDisconnect) {
          console.log("[BLE] Desconexión manual de FC detectada.");
          if (this.hrCallbacks && this.hrCallbacks.onDisconnect) {
            const sensorInfo = await DB.getSensor(device.id);
            const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Pulsómetro');
            this.hrCallbacks.onDisconnect(`${displayName} desconectado`);
          }
          return;
        }

        console.warn("[BLE] Desconexión inesperada de FC. Iniciando bucle de reconexión...");
        this.reconnectDevice(device, 'hr', this.hrCallbacks?.onValue, this.hrCallbacks?.onDisconnect);
      };
    }

    if (!this.onCscDisconnect) {
      this.onCscDisconnect = async (event) => {
        const device = event.target;
        this.isCscConnected = false;
        this.lastCrankRevolutions = -1;
        this.lastCrankEventTime = -1;
        this.cadenceBuffer = [];
        this.lastValidCadence = null;
        
        if (this.isManualDisconnect) {
          console.log("[BLE] Desconexión manual de Cadencia detectada.");
          if (this.cscCallbacks && this.cscCallbacks.onDisconnect) {
            const sensorInfo = await DB.getSensor(device.id);
            const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Sensor de Cadencia');
            this.cscCallbacks.onDisconnect(`${displayName} desconectado`);
          }
          return;
        }

        console.warn("[BLE] Desconexión inesperada de Cadencia. Iniciando bucle de reconexión...");
        this.reconnectDevice(device, 'cadence', this.cscCallbacks?.onValue, this.cscCallbacks?.onDisconnect);
      };
    }
  },

  // Método para actualizar el estado del sensor (despachando evento y callback)
  updateStatus(type, status, displayName) {
    if (this.onStatusUpdate) {
      this.onStatusUpdate(type, status, displayName);
    }
    window.dispatchEvent(new CustomEvent('ble-status-change', {
      detail: { type, status, displayName }
    }));
  },

  // Bucle de reconexión asíncrono resiliente
  async reconnectDevice(device, type, onValue, onDisconnect, maxRetries = 5, delayMs = 3000) {
    const isHr = (type === 'hr');
    if (isHr) {
      if (this.isHrReconnecting) return;
      this.isHrReconnecting = true;
    } else {
      if (this.isCscReconnecting) return;
      this.isCscReconnecting = true;
    }

    const sensorInfo = await DB.getSensor(device.id);
    const displayName = sensorInfo ? sensorInfo.customName : (device.name || (isHr ? 'Pulsómetro' : 'Sensor de Cadencia'));

    this.updateStatus(type, 'connecting', displayName);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.isManualDisconnect) {
        console.log(`[BLE] [${displayName}] Intento ${attempt}: Cancelando reconexión por desconexión manual.`);
        if (isHr) this.isHrReconnecting = false;
        else this.isCscReconnecting = false;
        return;
      }

      console.warn(`[BLE] [${displayName}] Intentando reconectar (${attempt}/${maxRetries})...`);

      try {
        if (isHr) {
          this.hrServer = await device.gatt.connect();
          const service = await this.hrServer.getPrimaryService('heart_rate');
          this.hrCharacteristic = await service.getCharacteristic('heart_rate_measurement');
          
          this.hrCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const val = event.target.value;
            const hr = this.parseHeartRate(val);
            if (onValue) onValue(hr);
          });
          
          await this.hrCharacteristic.startNotifications();
          this.isHrConnected = true;
        } else {
          this.cscServer = await device.gatt.connect();
          const service = await this.cscServer.getPrimaryService('cycling_speed_and_cadence');
          this.cscCharacteristic = await service.getCharacteristic('csc_measurement');
          
          this.cscCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            const val = event.target.value;
            const cadence = this.parseCadence(val);
            if (cadence !== null && onValue) {
              onValue(cadence);
            }
          });
          
          await this.cscCharacteristic.startNotifications();
          this.isCscConnected = true;
        }

        console.log(`[BLE] [${displayName}] Reconectado con éxito.`);
        this.updateStatus(type, 'connected', displayName);
        
        if (isHr) this.isHrReconnecting = false;
        else this.isCscReconnecting = false;
        return;
      } catch (err) {
        console.error(`[BLE] [${displayName}] Falló intento ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    if (isHr) this.isHrReconnecting = false;
    else this.isCscReconnecting = false;

    console.error(`[BLE] [${displayName}] No se pudo reconectar tras ${maxRetries} intentos.`);
    this.updateStatus(type, 'disconnected', displayName);

    if (onDisconnect) {
      onDisconnect(`${displayName} desconectado permanentemente.`);
    }
  },

  // Establecer conexión y registrar Fingerprint para FC
  async establishHrConnection(device, onValue, onDisconnect, isSilent = false) {
    console.log(`[BLE] Conectando GATT a dispositivo FC: ${device.name || device.id}`);
    this.isManualDisconnect = false;
    
    this.setupDisconnectListeners();
    this.hrCallbacks = { onValue, onDisconnect };
    device.removeEventListener('gattserverdisconnected', this.onHrDisconnect);
    device.addEventListener('gattserverdisconnected', this.onHrDisconnect);

    // Delay de 500ms para que el stack BLE de iOS/Bluefy se estabilice
    await new Promise(r => setTimeout(r, 500));

    this.hrServer = await device.gatt.connect();
    const service = await this.hrServer.getPrimaryService('heart_rate');
    this.hrCharacteristic = await service.getCharacteristic('heart_rate_measurement');
    
    this.hrCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = event.target.value;
      const hr = this.parseHeartRate(value);
      if (onValue) onValue(hr);
    });

    await this.hrCharacteristic.startNotifications();
    this.isHrConnected = true;

    // FINGERPRINTING: Registrar en IndexedDB
    await DB.saveSensor({
      deviceId: device.id,
      deviceType: 'hr',
      originalName: device.name || 'Sensor Cardíaco'
    });

    return device;
  },

  // Establecer conexión y registrar Fingerprint para Cadencia
  async establishCscConnection(device, onValue, onDisconnect, isSilent = false) {
    console.log(`[BLE] Conectando GATT a dispositivo Cadencia: ${device.name || device.id}`);
    this.isManualDisconnect = false;

    this.setupDisconnectListeners();
    this.cscCallbacks = { onValue, onDisconnect };
    device.removeEventListener('gattserverdisconnected', this.onCscDisconnect);
    device.addEventListener('gattserverdisconnected', this.onCscDisconnect);

    await new Promise(r => setTimeout(r, 500));

    this.cscServer = await device.gatt.connect();
    const service = await this.cscServer.getPrimaryService('cycling_speed_and_cadence');
    this.cscCharacteristic = await service.getCharacteristic('csc_measurement');

    this.cscCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = event.target.value;
      const cadence = this.parseCadence(value);
      if (cadence !== null && onValue) {
        onValue(cadence);
      }
    });

    await this.cscCharacteristic.startNotifications();
    this.isCscConnected = true;

    // FINGERPRINTING: Registrar en IndexedDB
    await DB.saveSensor({
      deviceId: device.id,
      deviceType: 'cadence',
      originalName: device.name || 'Sensor de Cadencia'
    });

    return device;
  },

  // RECONEXIÓN SILENCIOSA EN SEGUNDO PLANO
  async silentReconnect(onHrValue, onCscValue, onDisconnectCallback, onStatusUpdate) {
    try {
      if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
        console.warn("[BLE] Autoconexión no soportada por el navegador.");
        return false;
      }

      this.isManualDisconnect = false;
      this.onStatusUpdate = onStatusUpdate;

      console.log("[BLE] Buscando dispositivos previamente emparejados en el navegador...");
      const allowedDevices = await navigator.bluetooth.getDevices();
      
      if (allowedDevices.length === 0) {
        console.log("[BLE] No hay dispositivos autorizados previamente.");
        return false;
      }

      // Obtener los sensores registrados en nuestra base de datos IndexedDB
      const registeredSensors = await DB.getAllSensors();
      const registeredIds = registeredSensors.map(s => s.deviceId);

      for (const device of allowedDevices) {
        if (!registeredIds.includes(device.id)) continue; // Evitar conectarse a algo no guardado por el usuario

        const sensorInfo = registeredSensors.find(s => s.deviceId === device.id);

        if (sensorInfo.deviceType === 'hr' && !this.isHrConnected) {
          this.updateStatus('hr', 'connecting', sensorInfo.customName);
          
          this.hrDevice = device;
          this.establishHrConnection(device, onHrValue, onDisconnectCallback, true)
            .then(() => {
              console.log(`[BLE] Autoconexión exitosa a FC: ${sensorInfo.customName}`);
              this.updateStatus('hr', 'connected', sensorInfo.customName);
            })
            .catch(err => {
              console.error(`[BLE] Fallo de autoconexión a FC: ${sensorInfo.customName}`, err);
              this.updateStatus('hr', 'disconnected', sensorInfo.customName);
            });
        } 
        
        else if (sensorInfo.deviceType === 'cadence' && !this.isCscConnected) {
          // Filtrar por sensor vinculado a la bici seleccionada, si existe
          if (this.allowedCadenceDeviceId && device.id !== this.allowedCadenceDeviceId) {
            console.log(`[BLE] Saltando cadencia ${sensorInfo.customName}: no pertenece a la bici seleccionada.`);
            continue;
          }
          this.updateStatus('cadence', 'connecting', sensorInfo.customName);
          
          this.cscDevice = device;
          this.establishCscConnection(device, onCscValue, onDisconnectCallback, true)
            .then(() => {
              console.log(`[BLE] Autoconexión exitosa a Cadencia: ${sensorInfo.customName}`);
              this.updateStatus('cadence', 'connected', sensorInfo.customName);
            })
            .catch(err => {
              console.error(`[BLE] Fallo de autoconexión a Cadencia: ${sensorInfo.customName}`, err);
              this.updateStatus('cadence', 'disconnected', sensorInfo.customName);
            });
        }
      }
      return true;
    } catch (e) {
      console.error("[BLE] Error en la reconexión silenciosa:", e);
      return false;
    }
  },

  // Desconectar todos los sensores
  disconnectAll() {
    this.isManualDisconnect = true;
    this.isHrReconnecting = false;
    this.isCscReconnecting = false;
    if (this.hrDevice && this.hrDevice.gatt.connected) {
      this.hrDevice.gatt.disconnect();
    }
    if (this.cscDevice && this.cscDevice.gatt.connected) {
      this.cscDevice.gatt.disconnect();
    }
    this.isHrConnected = false;
    this.isCscConnected = false;
    this.cadenceBuffer = [];
    this.lastValidCadence = null;
  },

  // Manejador centralizado de errores con Fallback iOS
  handleBleError(error, sensorName) {
    console.error(`Error de conexión BLE (${sensorName}):`, error);
    if (error.message === "iOS_UNSUPPORTED") {
      alert(`Web Bluetooth no es soportado por Apple en Safari. Para conectar tus sensores en iPhone, descarga la App gratuita "Bluefy" desde la App Store.`);
    } else if (error.name !== 'NotFoundError') {
      alert(`No se pudo conectar el sensor de ${sensorName}. Verifica que esté encendido y que el Bluetooth del dispositivo esté activado.`);
    }
    // NUNCA lanzar — el error queda aislado, el thread principal sigue vivo
  },

  // Parseador de Frecuencia Cardíaca
  parseHeartRate(value) {
    const flags = value.getUint8(0);
    const is16Bit = (flags & 0x01) !== 0;
    if (is16Bit) {
      return value.getUint16(1, true);
    } else {
      return value.getUint8(1);
    }
  },

  // Parseador de Cadencia (con rolling average y rollover protection)
  parseCadence(value) {
    const flags = value.getUint8(0);
    const hasWheelData = (flags & 0x01) !== 0;
    const hasCrankData = (flags & 0x02) !== 0;

    let index = 1;
    if (hasWheelData) index += 6;

    if (hasCrankData) {
      const cumulativeRevolutions = value.getUint16(index, true);
      const lastEventTime = value.getUint16(index + 2, true);

      let rawCadence = null;

      if (this.lastCrankRevolutions !== -1 && this.lastCrankEventTime !== -1) {
        let diffRevs = cumulativeRevolutions - this.lastCrankRevolutions;
        if (diffRevs < 0) diffRevs += 65536;

        let diffTime = lastEventTime - this.lastCrankEventTime;
        if (diffTime < 0) diffTime += 65536;

        if (diffTime > 0 && diffRevs > 0) {
          const diffTimeSeconds = diffTime / 1024;
          rawCadence = Math.round((diffRevs / diffTimeSeconds) * 60);

          // Rollover rejection + cap at 200 RPM
          if (rawCadence > 200 || rawCadence < 0 || diffRevs > 200) {
            rawCadence = null;
          }
        } else if (diffTime > 2048 && diffRevs === 0) {
          rawCadence = 0;
        }
      }

      this.lastCrankRevolutions = cumulativeRevolutions;
      this.lastCrankEventTime = lastEventTime;

      // Rolling average: buffer de últimas 4 lecturas válidas
      if (rawCadence !== null) {
        this.cadenceBuffer.push(rawCadence);
        if (this.cadenceBuffer.length > 4) this.cadenceBuffer.shift();
        this.lastValidCadence = Math.round(this.cadenceBuffer.reduce((a, b) => a + b, 0) / this.cadenceBuffer.length);
        return this.lastValidCadence;
      }

      // Rollover: devolver el último RPM válido (no mostrar null salvo buffer vacío)
      return this.lastValidCadence;
    }
    return null;
  }
};
