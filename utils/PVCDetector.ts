// utils/PVCDetector.ts - FIXED BURDEN CALCULATION

export interface PVCEvent {
  timestamp: number;
  currentRR: number;
  expectedRR: number;
  percentagePremature: number;
}

export interface PVCDetectionResult {
  pvcCount: number;
  totalBeats: number;
  detectedBeats: number; // Actual R-peaks detected
  heartRate: number;
  isPVC: boolean;
  pvcEvents: PVCEvent[];
  timeSpanMs: number; // Add time span for burden calculation
}

export class ImprovedPVCDetector {
  private ecgBuffer: number[] = []
  private timeBuffer: number[] = []
  private rPeaks: number[] = []
  private peakAmplitudes: number[] = []
  private pvcCount = 0
  private lastPvcTime = 0
  private pvcEvents: PVCEvent[] = []
  private startTime: number = 0 // Track when monitoring started

  constructor(samplingRate: number = 130) {
    this.startTime = Date.now()
  }

  processECGSample(amplitude: number, timestamp: number): PVCDetectionResult {
    // Set start time on first sample
    if (this.startTime === 0) {
      this.startTime = timestamp
    }

    this.ecgBuffer.push(amplitude)
    this.timeBuffer.push(timestamp)
    
    if (this.ecgBuffer.length > 260) {
      this.ecgBuffer = this.ecgBuffer.slice(-260)
      this.timeBuffer = this.timeBuffer.slice(-260)
    }

    if (this.ecgBuffer.length % 10 === 0) {
      this.detectBeats()
    }

    return this.getResult()
  }

  private detectBeats() {
    if (this.ecgBuffer.length < 100) return

    const data = this.ecgBuffer
    const times = this.timeBuffer
    
    const mean = data.reduce((a, b) => a + b, 0) / data.length
    const std = Math.sqrt(data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length)
    const threshold = mean + 1.5 * std
    
    const newPeaks: number[] = []
    const minDistance = 39
    
    for (let i = minDistance; i < data.length - minDistance; i++) {
      if (data[i] > threshold && 
          data[i] > data[i-1] && 
          data[i] > data[i+1]) {
        
        const lastPeak = this.rPeaks.length > 0 ? this.rPeaks[this.rPeaks.length - 1] : 0
        if (times[i] - lastPeak > 300) {
          newPeaks.push(times[i])
          
          const windowSize = 7
          const start = Math.max(0, i - windowSize)
          const end = Math.min(data.length, i + windowSize)
          const segment = data.slice(start, end)
          const peakToPeak = Math.max(...segment) - Math.min(...segment)
          this.peakAmplitudes.push(peakToPeak)
        }
      }
    }

    for (let peakIndex = 0; peakIndex < newPeaks.length; peakIndex++) {
      const peakTime = newPeaks[peakIndex]
      const peakAmplitude = this.peakAmplitudes[this.peakAmplitudes.length - newPeaks.length + peakIndex]
      
      this.rPeaks.push(peakTime)
      
      const oldLength = this.rPeaks.length
      this.rPeaks = this.rPeaks.filter(t => peakTime - t < 30000)
      const removed = oldLength - this.rPeaks.length
      if (removed > 0) {
        this.peakAmplitudes = this.peakAmplitudes.slice(removed)
      }
      
      this.pvcEvents = this.pvcEvents.filter(e => peakTime - e.timestamp < 30000)
      
      if (this.rPeaks.length > 5) {
        const rrIntervals = []
        for (let i = 1; i < this.rPeaks.length; i++) {
          rrIntervals.push(this.rPeaks[i] - this.rPeaks[i-1])
        }
        
        const currentRR = rrIntervals[rrIntervals.length - 1]
        const recentRRs = rrIntervals.slice(-8)
        const medianRR = [...recentRRs].sort((a, b) => a - b)[Math.floor(recentRRs.length / 2)]
        
        const currentAmplitude = this.peakAmplitudes[this.peakAmplitudes.length - 1]
        const recentAmplitudes = this.peakAmplitudes.slice(-8)
        const avgAmplitude = recentAmplitudes.reduce((a, b) => a + b, 0) / recentAmplitudes.length
        
        const veryPremature = currentRR < medianRR * 0.60
        const highAmplitude = currentAmplitude > avgAmplitude * 1.25
        const physiologicalLimits = currentRR > 300 && currentRR < 1400
        const notTooFrequent = (peakTime - this.lastPvcTime) > 2000
        
        if ((veryPremature || highAmplitude) && physiologicalLimits && notTooFrequent) {
          this.pvcCount++
          this.lastPvcTime = peakTime
          
          const percentagePremature = Math.round((1 - currentRR / medianRR) * 100)
          this.pvcEvents.push({
            timestamp: peakTime,
            currentRR,
            expectedRR: medianRR,
            percentagePremature
          })
        }
      }
    }
  }

  private getResult(): PVCDetectionResult {
    let heartRate = 0
    if (this.rPeaks.length >= 2) {
      const recentPeaks = this.rPeaks.slice(-5)
      if (recentPeaks.length >= 2) {
        const avgInterval = (recentPeaks[recentPeaks.length - 1] - recentPeaks[0]) / (recentPeaks.length - 1)
        heartRate = Math.round(60000 / avgInterval)
        
        if (heartRate < 40 || heartRate > 180) heartRate = 0
      }
    }

    // Calculate time span and expected beats
    const currentTime = this.timeBuffer.length > 0 ? this.timeBuffer[this.timeBuffer.length - 1] : this.startTime
    const timeSpanMs = currentTime - this.startTime
    
    // Calculate expected total beats based on heart rate and time
    let expectedTotalBeats = this.rPeaks.length // Default to detected beats
    
    if (heartRate > 0 && timeSpanMs > 5000) { // Only calculate if we have good HR and >5 seconds
      expectedTotalBeats = Math.round((heartRate * timeSpanMs) / 60000) // HR * minutes
    }

    return {
      pvcCount: this.pvcCount,
      totalBeats: expectedTotalBeats, // Expected beats for burden calculation
      detectedBeats: this.rPeaks.length, // Actual detected R-peaks
      heartRate: heartRate,
      isPVC: false,
      pvcEvents: [...this.pvcEvents],
      timeSpanMs: timeSpanMs
    }
  }

  reset(): void {
    this.ecgBuffer = []
    this.timeBuffer = []
    this.rPeaks = []
    this.peakAmplitudes = []
    this.pvcCount = 0
    this.lastPvcTime = 0
    this.pvcEvents = []
    this.startTime = 0 // Reset start time
  }
}