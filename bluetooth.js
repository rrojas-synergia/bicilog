// bluetooth.js - Gestor BLE Avanzado (Emparejamiento, Fingerprinting y Reconexión Silenciosa)

import { DB } from './db.js';

export const BiciSensors = {
  hrDevice: null,
  cscDevice: null,
  hrServer: null,
  cscServer: null,
  hrCharacteristic: null,
  cscCharacteristic: null,

  // Estados
  isHrConnected: false,
  isCscConnected: false,

  // Variables para el cálculo de cadencia (Crank Revolutions)
  lastCrankRevolutions: -1,
  lastCrankEventTime: -1,

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

      console.log("[BLE] Solicitando pulsómetro con filtrado estricto GATT 0x180D...");
      this.hrDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }]
      });

      return await this.establishHrConnection(this.hrDevice, onValue, onDisconnect, false);
    } catch (error) {
      this.handleBleError(error, "Frecuencia Cardíaca");
    }
  },

  // Conectar sensor de Cadencia (Servicio Estándar 0x1816: Cycling Speed and Cadence)
  async connectCadence(onValue, onDisconnect) {
    try {
      this.checkBluetoothSupport();

      console.log("[BLE] Solicitando sensor de cadencia con filtrado estricto GATT 0x1816...");
      this.cscDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_speed_and_cadence'] }]
      });

      return await this.establishCscConnection(this.cscDevice, onValue, onDisconnect, false);
    } catch (error) {
      this.handleBleError(error, "Cadencia");
    }
  },

  // Establecer conexión y registrar Fingerprint para FC
  async establishHrConnection(device, onValue, onDisconnect, isSilent = false) {
    console.log(`[BLE] Conectando GATT a dispositivo FC: ${device.name || device.id}`);
    
    device.addEventListener('gattserverdisconnected', async (event) => {
      this.isHrConnected = false;
      if (onDisconnect) {
        // Buscar si tiene alias personalizado
        const sensorInfo = await DB.getSensor(device.id);
        const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Pulsómetro');
        onDisconnect(`${displayName} desconectado`);
      }
    });

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

    device.addEventListener('gattserverdisconnected', async (event) => {
      this.isCscConnected = false;
      this.lastCrankRevolutions = -1;
      this.lastCrankEventTime = -1;
      if (onDisconnect) {
        const sensorInfo = await DB.getSensor(device.id);
        const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Sensor de Cadencia');
        onDisconnect(`${displayName} desconectado`);
      }
    });

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
          if (onStatusUpdate) onStatusUpdate('hr', 'connecting', sensorInfo.customName);
          
          this.hrDevice = device;
          this.establishHrConnection(device, onHrValue, onDisconnectCallback, true)
            .then(() => {
              console.log(`[BLE] Autoconexión exitosa a FC: ${sensorInfo.customName}`);
              if (onStatusUpdate) onStatusUpdate('hr', 'connected', sensorInfo.customName);
            })
            .catch(err => {
              console.error(`[BLE] Fallo de autoconexión a FC: ${sensorInfo.customName}`, err);
              if (onStatusUpdate) onStatusUpdate('hr', 'disconnected', sensorInfo.customName);
            });
        } 
        
        else if (sensorInfo.deviceType === 'cadence' && !this.isCscConnected) {
          if (onStatusUpdate) onStatusUpdate('cadence', 'connecting', sensorInfo.customName);
          
          this.cscDevice = device;
          this.establishCscConnection(device, onCscValue, onDisconnectCallback, true)
            .then(() => {
              console.log(`[BLE] Autoconexión exitosa a Cadencia: ${sensorInfo.customName}`);
              if (onStatusUpdate) onStatusUpdate('cadence', 'connected', sensorInfo.customName);
            })
            .catch(err => {
              console.error(`[BLE] Fallo de autoconexión a Cadencia: ${sensorInfo.customName}`, err);
              if (onStatusUpdate) onStatusUpdate('cadence', 'disconnected', sensorInfo.customName);
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
    if (this.hrDevice && this.hrDevice.gatt.connected) {
      this.hrDevice.gatt.disconnect();
    }
    if (this.cscDevice && this.cscDevice.gatt.connected) {
      this.cscDevice.gatt.disconnect();
    }
    this.isHrConnected = false;
    this.isCscConnected = false;
  },

  // Manejador centralizado de errores con Fallback iOS
  handleBleError(error, sensorName) {
    console.error(`Error de conexión BLE (${sensorName}):`, error);
    if (error.message === "iOS_UNSUPPORTED") {
      alert(`Web Bluetooth no es soportado por Apple en Safari. Para conectar tus sensores en iPhone, descarga la App gratuita "Bluefy" desde la App Store.`);
    } else {
      alert(`No se pudo conectar el sensor de ${sensorName}. Verifica que esté encendido y que el Bluetooth del dispositivo esté activado.`);
    }
    throw error;
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

  // Parseador de Cadencia
  parseCadence(value) {
    const flags = value.getUint8(0);
    const hasWheelData = (flags & 0x01) !== 0;
    const hasCrankData = (flags & 0x02) !== 0;
    
    let index = 1;
    if (hasWheelData) index += 6; // Saltar rueda
    
    if (hasCrankData) {
      const cumulativeRevolutions = value.getUint16(index, true);
      const lastEventTime = value.getUint16(index + 2, true);
      
      let cadence = null;
      
      if (this.lastCrankRevolutions !== -1 && this.lastCrankEventTime !== -1) {
        let diffRevs = cumulativeRevolutions - this.lastCrankRevolutions;
        if (diffRevs < 0) diffRevs += 65536;
        
        let diffTime = lastEventTime - this.lastCrankEventTime;
        if (diffTime < 0) diffTime += 65536;
        
        if (diffTime > 0 && diffRevs > 0) {
          const diffTimeSeconds = diffTime / 1024;
          cadence = Math.round((diffRevs / diffTimeSeconds) * 60);
          if (cadence > 220) cadence = null;
        } else if (diffTime > 2048) {
          cadence = 0;
        }
      }
      
      this.lastCrankRevolutions = cumulativeRevolutions;
      this.lastCrankEventTime = lastEventTime;
      return cadence;
    }
    return null;
  }
};
