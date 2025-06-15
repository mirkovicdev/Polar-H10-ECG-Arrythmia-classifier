// utils/PVCDetector.ts - MINIMAL FIX (KEEP WORKING BPM!) + PVC Events

export interface PVCEvent {
  timestamp: number;
  currentRR: number;
  expectedRR: number;
  percentagePremature: number;
}

export interface PVCDetectionResult {
  pvcCount: number;
  totalBeats: number;
  heartRate: number;
  isPVC: boolean;
  pvcEvents: PVCEvent[];
}

export class ImprovedPVCDetector {
  private ecgBuffer: number[] = []
  private timeBuffer: number[] = []
  private rPeaks: number[] = []
  private pvcCount = 0
  private lastPvcTime = 0
  private pvcEvents: PVCEvent[] = [] // Store PVC events

  constructor(samplingRate: number = 130) {
    // Simple constructor
  }

  processECGSample(amplitude: number, timestamp: number): PVCDetectionResult {
    // Add to buffer
    this.ecgBuffer.push(amplitude)
    this.timeBuffer.push(timestamp)
    
    // Keep only last 2 seconds for processing
    if (this.ecgBuffer.length > 260) { // 260 samples = 2 seconds at 130Hz
      this.ecgBuffer = this.ecgBuffer.slice(-260)
      this.timeBuffer = this.timeBuffer.slice(-260)
    }

    // Process every 10 samples (not every single sample)
    if (this.ecgBuffer.length % 10 === 0) {
      this.detectBeats()
    }

    return this.getResult()
  }

  private detectBeats() {
    if (this.ecgBuffer.length < 100) return

    const data = this.ecgBuffer
    const times = this.timeBuffer
    
    // KEEP ORIGINAL: Simple peak detection that WORKS
    const mean = data.reduce((a, b) => a + b, 0) / data.length
    const std = Math.sqrt(data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length)
    const threshold = mean + 1.5 * std
    
    // KEEP ORIGINAL: Find peaks in recent data
    const newPeaks: number[] = []
    const minDistance = 39 // 300ms at 130Hz
    
    for (let i = minDistance; i < data.length - minDistance; i++) {
      if (data[i] > threshold && 
          data[i] > data[i-1] && 
          data[i] > data[i+1]) {
        
        // Check if far enough from last peak
        const lastPeak = this.rPeaks.length > 0 ? this.rPeaks[this.rPeaks.length - 1] : 0
        if (times[i] - lastPeak > 300) { // 300ms minimum
          newPeaks.push(times[i])
        }
      }
    }

    // Add new peaks and check for PVCs
    newPeaks.forEach(peakTime => {
      this.rPeaks.push(peakTime)
      
      // Keep only recent peaks (last 30 seconds)
      this.rPeaks = this.rPeaks.filter(t => peakTime - t < 30000)
      // Clean old PVC events too
      this.pvcEvents = this.pvcEvents.filter(e => peakTime - e.timestamp < 30000)
      
      // ONLY CHANGE: More conservative PVC detection + store events
      if (this.rPeaks.length > 5) { // Need at least 6 beats
        const rrIntervals = []
        for (let i = 1; i < this.rPeaks.length; i++) {
          rrIntervals.push(this.rPeaks[i] - this.rPeaks[i-1])
        }
        
        // Get current and baseline RR
        const currentRR = rrIntervals[rrIntervals.length - 1]
        const recentRRs = rrIntervals.slice(-8) // Last 8 intervals for stable baseline
        const medianRR = [...recentRRs].sort((a, b) => a - b)[Math.floor(recentRRs.length / 2)]
        
        // ONLY CHANGE: Much more conservative PVC detection
        const veryPremature = currentRR < medianRR * 0.60 // 60% instead of 70%
        const physiologicalLimits = currentRR > 300 && currentRR < 1400
        const notTooFrequent = (peakTime - this.lastPvcTime) > 2000 // 2 seconds minimum between PVCs
        
        if (veryPremature && physiologicalLimits && notTooFrequent) {
          this.pvcCount++
          this.lastPvcTime = peakTime
          
          // Store PVC event details
          const percentagePremature = Math.round((1 - currentRR / medianRR) * 100)
          this.pvcEvents.push({
            timestamp: peakTime,
            currentRR,
            expectedRR: medianRR,
            percentagePremature
          })
        }
      }
    })
  }

  private getResult(): PVCDetectionResult {
    // KEEP ORIGINAL: Calculate heart rate from recent beats (THIS WORKS!)
    let heartRate = 0
    if (this.rPeaks.length >= 2) {
      const recentPeaks = this.rPeaks.slice(-5) // Last 5 beats
      if (recentPeaks.length >= 2) {
        const avgInterval = (recentPeaks[recentPeaks.length - 1] - recentPeaks[0]) / (recentPeaks.length - 1)
        heartRate = Math.round(60000 / avgInterval) // Convert to BPM
        
        // Validate reasonable range
        if (heartRate < 40 || heartRate > 180) heartRate = 0
      }
    }

    return {
      pvcCount: this.pvcCount,
      totalBeats: this.rPeaks.length,
      heartRate: heartRate,
      isPVC: false, // Not tracking individual beats
      pvcEvents: [...this.pvcEvents] // Return copy of events
    }
  }

  reset(): void {
    this.ecgBuffer = []
    this.timeBuffer = []
    this.rPeaks = []
    this.pvcCount = 0
    this.lastPvcTime = 0
    this.pvcEvents = [] // Reset events
  }
}