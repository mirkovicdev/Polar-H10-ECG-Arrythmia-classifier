// utils/PVCDetector.ts - Simple Fix for Multifocal PVCs (No Overcomplications)

export interface PVCEvent {
  timestamp: number;
  currentRR: number;
  expectedRR: number;
  percentagePremature: number;
  qrsWidth: number;
  confidence: number;
  morphologyScore: number;
  detectionPathway: 'high-amplitude' | 'wide-qrs' | 'premature-morph';
  amplitude: number;
}

export interface PVCDetectionResult {
  pvcCount: number;
  totalBeats: number;
  detectedBeats: number;
  heartRate: number;
  isPVC: boolean;
  pvcEvents: PVCEvent[];
  timeSpanMs: number;
  signalQuality: number;
}

export class ImprovedPVCDetector {
  private ecgBuffer: number[] = []
  private timeBuffer: number[] = []
  private rPeaks: number[] = []
  private rPeakAmplitudes: number[] = []
  private qrsWidths: number[] = []
  private normalTemplates: number[][] = []
  private rrHistory: number[] = []
  private pvcCount = 0
  private pvcEvents: PVCEvent[] = []
  private startTime: number = 0
  private totalDetectedBeats = 0

  constructor(private samplingRate: number = 130) {
    this.startTime = Date.now()
  }

  processECGSample(amplitude: number, timestamp: number): PVCDetectionResult {
    if (this.startTime === 0) {
      this.startTime = timestamp
    }

    this.ecgBuffer.push(amplitude)
    this.timeBuffer.push(timestamp)

    if (this.ecgBuffer.length > 390) { // 3 seconds at 130Hz
      this.ecgBuffer = this.ecgBuffer.slice(-390)
      this.timeBuffer = this.timeBuffer.slice(-390)
    }

    if (this.ecgBuffer.length % 10 === 0) {
      this.detectBeats()
    }

    return this.getResult()
  }

  private detectBeats() {
    if (this.ecgBuffer.length < 130) return

    const data = this.ecgBuffer
    const times = this.timeBuffer
    
    // Calculate thresholds for both positive and negative peaks
    const mean = data.reduce((a, b) => a + b, 0) / data.length
    const std = Math.sqrt(data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length)
    const upperThreshold = mean + 1.4 * std  // For positive peaks
    const lowerThreshold = mean - 1.4 * std  // For negative peaks

    const minDistance = Math.floor(this.samplingRate * 0.3) // 300ms minimum
    const newPeaks: { time: number; index: number; amplitude: number }[] = []

    for (let i = minDistance; i < data.length - minDistance; i++) {
      let isPeak = false
      let peakAmplitude = data[i]
      
      // Check for positive peak (upward deflection)
      if (data[i] > upperThreshold && 
          data[i] > data[i - 1] && 
          data[i] > data[i + 1] &&
          this.isValidPeak(data, i, 'positive')) {
        isPeak = true
      }
      
      // Check for negative peak (downward deflection)
      else if (data[i] < lowerThreshold && 
               data[i] < data[i - 1] && 
               data[i] < data[i + 1] &&
               this.isValidPeak(data, i, 'negative')) {
        isPeak = true
        peakAmplitude = Math.abs(data[i]) // Use absolute value for amplitude
      }
      
      if (isPeak) {
        const lastPeakTime = this.rPeaks.length > 0 ? this.rPeaks[this.rPeaks.length - 1] : 0
        if (times[i] - lastPeakTime > 300) {
          newPeaks.push({
            time: times[i],
            index: i,
            amplitude: peakAmplitude
          })
        }
      }
    }

    for (const peak of newPeaks) {
      this.processPeak(peak, data)
    }
  }

  private isValidPeak(data: number[], index: number, direction: 'positive' | 'negative'): boolean {
    const windowSize = 5
    const start = Math.max(0, index - windowSize)
    const end = Math.min(data.length, index + windowSize)
    
    let invalidCount = 0
    for (let i = start; i < end; i++) {
      if (i !== index) {
        if (direction === 'positive' && data[i] >= data[index]) {
          invalidCount++
        } else if (direction === 'negative' && data[i] <= data[index]) {
          invalidCount++
        }
      }
    }
    
    return invalidCount <= 1
  }

  private processPeak(peak: { time: number; index: number; amplitude: number }, data: number[]) {
    this.rPeaks.push(peak.time)
    this.rPeakAmplitudes.push(peak.amplitude)
    this.totalDetectedBeats++

    const qrsWidth = this.calculateQRSWidth(data, peak.index)
    this.qrsWidths.push(qrsWidth)

    // Clean old data (keep 2 minutes)
    const cutoffTime = peak.time - 120000
    this.cleanOldData(cutoffTime)

    if (this.rPeaks.length < 8) return

    this.updateRRHistory()

    const analysis = this.analyzeBeat(peak, data, qrsWidth)
    
    if (analysis.isPVC) {
      this.pvcCount++
      this.pvcEvents.push({
        timestamp: peak.time,
        currentRR: analysis.currentRR,
        expectedRR: analysis.expectedRR,
        percentagePremature: analysis.percentagePremature,
        qrsWidth: qrsWidth,
        confidence: analysis.confidence,
        morphologyScore: analysis.morphologyScore,
        detectionPathway: analysis.pathway,
        amplitude: peak.amplitude
      })

      console.log('🚨 PVC DETECTED 🚨')
      console.log(`PATHWAY: ${analysis.pathway}`)
      console.log(`TIME: ${new Date(peak.time).toLocaleTimeString()}`)
      console.log(`QRS: ${qrsWidth.toFixed(1)}ms | AMP: ${peak.amplitude.toFixed(0)}μV`)
      console.log(`CONFIDENCE: ${analysis.confidence.toFixed(2)}`)
      console.log('─'.repeat(60))
    } else {
      // Store as normal template only if it's clearly normal
      if (analysis.confidence < 0.3) { // Only store very normal beats
        this.storeNormalTemplate(data, peak.index)
      }
    }
  }

  private analyzeBeat(peak: { time: number; index: number; amplitude: number }, data: number[], qrsWidth: number) {
    const currentRR = this.rrHistory[this.rrHistory.length - 1]
    
    // Use more robust statistics
    const recentRRs = this.rrHistory.slice(-20)
    const sortedRRs = [...recentRRs].sort((a, b) => a - b)
    const medianRR = sortedRRs[Math.floor(sortedRRs.length / 2)]
    const expectedRR = medianRR
    
    // **SIMPLIFIED 3-PATHWAY DETECTION**
    
    // Pathway 1: High-amplitude PVCs (your original working method)
    const isHighAmplitude = peak.amplitude > 600
    const isVeryHighAmplitude = peak.amplitude > 800
    
    // Pathway 2: Wide QRS
    const isWide = qrsWidth > 120 // Keep standard threshold
    
    // Pathway 3: Premature + Morphology (FIXED for multifocal)
    const isPremature = currentRR < expectedRR * 0.75 // Conservative threshold
    const isVeryPremature = currentRR < expectedRR * 0.65
    
    // FIXED morphology scoring - only dissimilarity from normal
    const morphologyScore = this.calculateSimpleMorphology(data, peak.index)
    const hasAbnormalMorphology = morphologyScore > 0.4 // Conservative threshold
    
    // SIMPLE DECISION LOGIC (no overcomplications)
    let pathway: PVCEvent['detectionPathway'] = 'high-amplitude'
    let confidence = 0
    let isPVC = false
    
    // Pathway 1: High-amplitude (original working method)
    if (isVeryHighAmplitude || (isHighAmplitude && isPremature)) {
      isPVC = true
      pathway = 'high-amplitude'
      confidence = 0.9
    }
    
    // Pathway 2: Wide QRS
    else if (isWide && isPremature) {
      isPVC = true
      pathway = 'wide-qrs'
      confidence = 0.8
    }
    
    // Pathway 3: Premature + Very abnormal morphology (for multifocal)
    else if (isVeryPremature && hasAbnormalMorphology) {
      isPVC = true
      pathway = 'premature-morph'
      confidence = 0.7
    }
    
    const percentagePremature = Math.round((1 - currentRR / expectedRR) * 100)
    
    return {
      isPVC,
      currentRR,
      expectedRR,
      percentagePremature,
      confidence,
      morphologyScore,
      pathway
    }
  }

  private calculateSimpleMorphology(data: number[], peakIndex: number): number {
    // Simple morphology - just dissimilarity from normal beats
    const beatWindow = 60
    const start = Math.max(0, peakIndex - beatWindow)
    const end = Math.min(data.length, peakIndex + beatWindow)
    const currentBeat = data.slice(start, end)
    
    // Normalize
    const maxAmp = Math.max(...currentBeat.map(Math.abs))
    if (maxAmp === 0) return 0
    const normalizedBeat = currentBeat.map(x => x / maxAmp)
    
    // Compare with normal templates
    let maxCorrelation = 0
    for (const template of this.normalTemplates.slice(-10)) {
      const correlation = this.calculateCorrelation(normalizedBeat, template)
      maxCorrelation = Math.max(maxCorrelation, correlation)
    }
    
    // Return dissimilarity (1 - correlation)
    return Math.max(0, 1 - maxCorrelation)
  }

  private calculateQRSWidth(data: number[], peakIndex: number): number {
    const searchWindow = Math.floor(this.samplingRate * 0.08) // 80ms window
    const start = Math.max(0, peakIndex - searchWindow)
    const end = Math.min(data.length, peakIndex + searchWindow)
    
    const baseline = this.calculateLocalBaseline(data, peakIndex)
    const threshold = Math.abs(data[peakIndex] - baseline) * 0.1
    
    // Find onset
    let onset = peakIndex
    for (let i = peakIndex - 1; i >= start; i--) {
      if (Math.abs(data[i] - baseline) < threshold) {
        onset = i
        break
      }
    }
    
    // Find offset
    let offset = peakIndex
    for (let i = peakIndex + 1; i < end; i++) {
      if (Math.abs(data[i] - baseline) < threshold) {
        offset = i
        break
      }
    }
    
    return ((offset - onset) / this.samplingRate) * 1000
  }

  private calculateLocalBaseline(data: number[], peakIndex: number): number {
    const windowSize = 20
    const beforeStart = Math.max(0, peakIndex - windowSize * 2)
    const beforeEnd = Math.max(0, peakIndex - windowSize)
    const afterStart = Math.min(data.length, peakIndex + windowSize)
    const afterEnd = Math.min(data.length, peakIndex + windowSize * 2)
    
    const beforeValues = data.slice(beforeStart, beforeEnd)
    const afterValues = data.slice(afterStart, afterEnd)
    const allValues = [...beforeValues, ...afterValues]
    
    return allValues.length > 0 ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0
  }

  private updateRRHistory() {
    if (this.rPeaks.length < 2) return
    
    const newRRs: number[] = []
    for (let i = 1; i < this.rPeaks.length; i++) {
      newRRs.push(this.rPeaks[i] - this.rPeaks[i - 1])
    }
    
    this.rrHistory = newRRs
    
    if (this.rrHistory.length > 30) {
      this.rrHistory = this.rrHistory.slice(-30)
    }
  }

  private calculateCorrelation(beat1: number[], beat2: number[]): number {
    const minLength = Math.min(beat1.length, beat2.length)
    if (minLength < 10) return 0
    
    const b1 = beat1.slice(0, minLength)
    const b2 = beat2.slice(0, minLength)
    
    const mean1 = b1.reduce((a, b) => a + b, 0) / b1.length
    const mean2 = b2.reduce((a, b) => a + b, 0) / b2.length
    
    let numerator = 0
    let sum1 = 0
    let sum2 = 0
    
    for (let i = 0; i < minLength; i++) {
      const diff1 = b1[i] - mean1
      const diff2 = b2[i] - mean2
      numerator += diff1 * diff2
      sum1 += diff1 * diff1
      sum2 += diff2 * diff2
    }
    
    const denominator = Math.sqrt(sum1 * sum2)
    return denominator === 0 ? 0 : numerator / denominator
  }

  private storeNormalTemplate(data: number[], peakIndex: number) {
    const beatWindow = 60
    const start = Math.max(0, peakIndex - beatWindow)
    const end = Math.min(data.length, peakIndex + beatWindow)
    const beat = data.slice(start, end)
    
    const maxAmp = Math.max(...beat.map(Math.abs))
    if (maxAmp === 0) return
    const normalizedBeat = beat.map(x => x / maxAmp)
    
    this.normalTemplates.push(normalizedBeat)
    
    if (this.normalTemplates.length > 12) {
      this.normalTemplates = this.normalTemplates.slice(-12)
    }
  }

  private cleanOldData(cutoffTime: number) {
    const validIndices: number[] = []
    for (let i = 0; i < this.rPeaks.length; i++) {
      if (this.rPeaks[i] >= cutoffTime) {
        validIndices.push(i)
      }
    }
    
    if (validIndices.length > 0 && validIndices[0] > 0) {
      this.rPeaks = validIndices.map(i => this.rPeaks[i])
      this.rPeakAmplitudes = validIndices.map(i => this.rPeakAmplitudes[i])
      this.qrsWidths = validIndices.map(i => this.qrsWidths[i])
    }
    
    this.pvcEvents = this.pvcEvents.filter(e => e.timestamp >= cutoffTime)
  }

  private calculateSignalQuality(): number {
    if (this.ecgBuffer.length < 130) return 0
    
    const data = this.ecgBuffer.slice(-130)
    const mean = data.reduce((a, b) => a + b, 0) / data.length
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length
    const snr = Math.abs(mean) / Math.sqrt(variance)
    
    return Math.min(1, snr / 10)
  }

  private getResult(): PVCDetectionResult {
    let heartRate = 0
    if (this.rrHistory.length >= 3) {
      const recentRRs = this.rrHistory.slice(-5)
      const avgInterval = recentRRs.reduce((a, b) => a + b, 0) / recentRRs.length
      heartRate = Math.round(60000 / avgInterval)
      if (heartRate < 40 || heartRate > 200) heartRate = 0
    }

    const currentTime = this.timeBuffer.length > 0 ? this.timeBuffer[this.timeBuffer.length - 1] : this.startTime
    const timeSpanMs = currentTime - this.startTime

    return {
      pvcCount: this.pvcCount,
      totalBeats: this.totalDetectedBeats,
      detectedBeats: this.rPeaks.length,
      heartRate,
      isPVC: false,
      pvcEvents: [...this.pvcEvents],
      timeSpanMs,
      signalQuality: this.calculateSignalQuality()
    }
  }

  reset(): void {
    this.ecgBuffer = []
    this.timeBuffer = []
    this.rPeaks = []
    this.rPeakAmplitudes = []
    this.qrsWidths = []
    this.normalTemplates = []
    this.rrHistory = []
    this.pvcCount = 0
    this.pvcEvents = []
    this.startTime = 0
    this.totalDetectedBeats = 0
  }
}