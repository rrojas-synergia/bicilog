// bluetooth.js - Integración con Sensores BLE (Frecuencia Cardíaca y Cadencia)

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
  lastWheelRevolutions: -1,
  lastWheelEventTime: -1,
  lastCrankRevolutions: -1,
  lastCrankEventTime: -1,

  // Conectar sensor de Frecuencia Cardíaca (Servicio Estándar 0x180D)
  async connectHeartRate(onValue, onDisconnect) {
    try {
      console.log("Solicitando dispositivo de frecuencia cardíaca...");
      this.hrDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }]
      });

      this.hrDevice.addEventListener('gattserverdisconnected', (event) => {
        this.isHrConnected = false;
        if (onDisconnect) onDisconnect('Frecuencia Cardíaca desconectada');
      });

      console.log("Conectando al servidor GATT...");
      this.hrServer = await this.hrDevice.gatt.connect();
      
      console.log("Obteniendo servicio de Frecuencia Cardíaca...");
      const service = await this.hrServer.getPrimaryService('heart_rate');
      
      console.log("Obteniendo característica de Medición de FC...");
      this.hrCharacteristic = await service.getCharacteristic('heart_rate_measurement');
      
      this.hrCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const hr = this.parseHeartRate(value);
        if (onValue) onValue(hr);
      });

      console.log("Iniciando notificaciones de FC...");
      await this.hrCharacteristic.startNotifications();
      this.isHrConnected = true;
      return true;
    } catch (error) {
      console.error("Error al conectar sensor de FC:", error);
      throw error;
    }
  },

  // Conectar sensor de Cadencia (Servicio Estándar 0x1816: Cycling Speed and Cadence)
  async connectCadence(onValue, onDisconnect) {
    try {
      console.log("Solicitando dispositivo de velocidad y cadencia (CSC)...");
      this.cscDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_speed_and_cadence'] }]
      });

      this.cscDevice.addEventListener('gattserverdisconnected', (event) => {
        this.isCscConnected = false;
        this.lastCrankRevolutions = -1;
        this.lastCrankEventTime = -1;
        if (onDisconnect) onDisconnect('Sensor de Cadencia desconectado');
      });

      console.log("Conectando al servidor GATT...");
      this.cscServer = await this.cscDevice.gatt.connect();

      console.log("Obteniendo servicio CSC...");
      const service = await this.cscServer.getPrimaryService('cycling_speed_and_cadence');

      console.log("Obteniendo característica CSC Measurement...");
      this.cscCharacteristic = await service.getCharacteristic('csc_measurement');

      this.cscCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = event.target.value;
        const cadence = this.parseCadence(value);
        if (cadence !== null && onValue) {
          onValue(cadence);
        }
      });

      console.log("Iniciando notificaciones de CSC...");
      await this.cscCharacteristic.startNotifications();
      this.isCscConnected = true;
      return true;
    } catch (error) {
      console.error("Error al conectar sensor CSC:", error);
      throw error;
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

  // Parseador estándar de Frecuencia Cardíaca (GATT Specification)
  parseHeartRate(value) {
    // El primer byte contiene los flags
    const flags = value.getUint8(0);
    // Bit 0 determina si la FC es de 8 o 16 bits
    const is16Bit = (flags & 0x01) !== 0;
    
    if (is16Bit) {
      return value.getUint16(1, true); // True para Little Endian
    } else {
      return value.getUint8(1);
    }
  },

  // Parseador estándar de Cadencia (GATT CSC Measurement Specification)
  parseCadence(value) {
    const flags = value.getUint8(0);
    
    // Bit 0: Wheel Revolution Data Present
    const hasWheelData = (flags & 0x01) !== 0;
    // Bit 1: Crank Revolution Data Present (Cadencia)
    const hasCrankData = (flags & 0x02) !== 0;
    
    let index = 1;
    
    // Saltar datos de rueda si están presentes
    if (hasWheelData) {
      // 4 bytes: Cumulative Wheel Revolutions
      // 2 bytes: Last Wheel Event Time
      index += 6;
    }
    
    if (hasCrankData) {
      const cumulativeRevolutions = value.getUint16(index, true);
      const lastEventTime = value.getUint16(index + 2, true); // en 1/1024 segundos
      
      let cadence = null;
      
      if (this.lastCrankRevolutions !== -1 && this.lastCrankEventTime !== -1) {
        // Calcular diferencias manejando desbordamientos de 16 bits (65535)
        let diffRevs = cumulativeRevolutions - this.lastCrankRevolutions;
        if (diffRevs < 0) diffRevs += 65536;
        
        let diffTime = lastEventTime - this.lastCrankEventTime;
        if (diffTime < 0) diffTime += 65536;
        
        if (diffTime > 0 && diffRevs > 0) {
          // Cadencia en RPM = (Diferencia de revoluciones / Diferencia de tiempo en segundos) * 60
          // diffTime está en unidades de 1/1024 s, por lo que segundos = diffTime / 1024
          const diffTimeSeconds = diffTime / 1024;
          cadence = Math.round((diffRevs / diffTimeSeconds) * 60);
          
          // Limitar valores de cadencia atípicos (por encima de 200 RPM en bici suele ser ruido)
          if (cadence > 220) cadence = null;
        } else if (diffTime > 2048) { // Más de 2 segundos sin eventos significa que dejó de pedalear
          cadence = 0;
        }
      }
      
      // Guardar el estado anterior
      this.lastCrankRevolutions = cumulativeRevolutions;
      this.lastCrankEventTime = lastEventTime;
      
      return cadence;
    }
    
    return null;
  }
};
