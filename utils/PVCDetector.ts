// utils/PVCDetector.ts - Simple Fix for Multifocal PVCs (No Overcomplications)

import { MorphologyTrainer, type TrainingResult } from './MorphologyTrainer'

export interface PVCEvent {
  timestamp: number;
  currentRR: number;
  expectedRR: number;
  percentagePremature: number;
  qrsWidth: number;
  confidence: number;
  morphologyScore: number;
  detectionPathway: 'high-amplitude' | 'wide-qrs' | 'premature-morph' | 'gap-detected' | 'morphology-only';
  amplitude: number;
  isInferred?: boolean; // NEW: Mark inferred PVCs
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
  private inferredPvcEvents: PVCEvent[] = [] // NEW: Track inferred PVCs separately
  private startTime: number = 0
  private totalDetectedBeats = 0

  // ADD: Smart training with morphology clustering
  private morphologyTrainer = new MorphologyTrainer()
  public isLearningMode = true // Make public for ECG chart access
  public learningBeatCount = 0 // Make public for ECG chart access
  public maxLearningBeats = 40 // Make public for ECG chart access
  private learningBeats: { data: number[], index: number, amplitude: number, qrsWidth: number }[] = []
  public trainingResult: TrainingResult | null = null // Make public for debug access

  constructor(private samplingRate: number = 130) {
    this.startTime = Date.now()
  }

  // ADD: Method to check training status for ECG chart
  public getTrainingStatus() {
    return {
      isLearning: this.isLearningMode,
      progress: this.learningBeatCount,
      total: this.maxLearningBeats,
      trainingResult: this.trainingResult
    }
  }

  // NEW: Parallel Gap-Based PVC Detection System
  private detectGapBasedPVCs() {
    if (this.rPeaks.length < 6) return
    
    // Only run gap detection occasionally to avoid spam
    if (this.rPeaks.length % 5 !== 0) return
    
    // Calculate expected RR interval from recent normal beats
    const recentRRs = this.rrHistory.slice(-10)
    const normalRRs = recentRRs.filter(rr => rr > 500 && rr < 1200) // Stricter filtering
    if (normalRRs.length < 5) return
    
    const sortedNormalRRs = [...normalRRs].sort((a, b) => a - b)
    const medianNormalRR = sortedNormalRRs[Math.floor(sortedNormalRRs.length / 2)]
    
    // Only check the most recent RR interval
    const lastIndex = this.rPeaks.length - 1
    if (lastIndex < 1) return
    
    const currentRR = this.rPeaks[lastIndex] - this.rPeaks[lastIndex - 1]
    const prevBeatTime = this.rPeaks[lastIndex - 1]
    const nextBeatTime = this.rPeaks[lastIndex]
    
    // Much more conservative gap detection
    const isVeryLongGap = currentRR > medianNormalRR * 1.8 // 80% longer (very conservative)
    
    if (isVeryLongGap) {
      // Check if both surrounding beats are normal
      const prevBeatIsPVC = this.pvcEvents.some(pvc => Math.abs(pvc.timestamp - prevBeatTime) < 200)
      const nextBeatIsPVC = this.pvcEvents.some(pvc => Math.abs(pvc.timestamp - nextBeatTime) < 200)
      
      // Check if we already inferred a PVC in this gap
      const alreadyInferred = this.inferredPvcEvents.some(pvc => 
        pvc.timestamp > prevBeatTime && pvc.timestamp < nextBeatTime
      )
      
      if (!prevBeatIsPVC && !nextBeatIsPVC && !alreadyInferred) {
        // Only infer 1 PVC for very obvious gaps
        const estimatedTimestamp = prevBeatTime + (currentRR / 2)
        
        const inferredPVC: PVCEvent = {
          timestamp: estimatedTimestamp,
          currentRR: currentRR / 2,
          expectedRR: medianNormalRR,
          percentagePremature: 0,
          qrsWidth: 0,
          confidence: 0.5, // Lower confidence
          morphologyScore: 0,
          detectionPathway: 'gap-detected',
          amplitude: 0,
          isInferred: true
        }
        
        this.inferredPvcEvents.push(inferredPVC)
        this.pvcCount++
        
        console.log('🔍 GAP-DETECTED PVC 🔍')
        console.log(`GAP: ${currentRR}ms (expected: ${medianNormalRR}ms)`)
        console.log('─'.repeat(60))
      }
    }
    
    // Clean old inferred events
    const cutoffTime = Date.now() - 120000
    this.inferredPvcEvents = this.inferredPvcEvents.filter(e => e.timestamp >= cutoffTime)
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
    
    // NEW: Run parallel gap-based detection after beat processing
    if (this.rPeaks.length > 5) {
      this.detectGapBasedPVCs()
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

    // ADD: Handle learning mode
    if (this.isLearningMode) {
      this.handleLearningMode(peak, data, qrsWidth)
      return // Don't run PVC detection during learning
    }

    if (this.rPeaks.length < 8) return

    // FIXED: Add current RR to history BEFORE analysis
    if (this.rPeaks.length >= 2) {
      const currentRR = this.rPeaks[this.rPeaks.length - 1] - this.rPeaks[this.rPeaks.length - 2]
      this.rrHistory.push(currentRR)
    }

    const analysis = this.analyzeBeat(peak, data, qrsWidth)
    
    // FIXED: Update RR history AFTER analysis to avoid contamination
    this.updateRRHistory()
    
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
        amplitude: peak.amplitude,
        isInferred: false // Direct detection
      })

      console.log('🚨 PVC DETECTED 🚨')
      console.log(`PATHWAY: ${analysis.pathway}`)
      console.log(`TIME: ${new Date(peak.time).toLocaleTimeString()}`)
      console.log(`QRS: ${qrsWidth.toFixed(1)}ms | AMP: ${peak.amplitude.toFixed(0)}μV`)
      console.log(`CONFIDENCE: ${analysis.confidence.toFixed(2)}`)
      console.log('─'.repeat(60))
    } else {
      // FIXED: Store as normal template only if it's VERY clearly normal (prevent contamination)
      if (this.rrHistory.length > 0) {
        const currentRR = this.rrHistory[this.rrHistory.length - 1]
        const recentRRs = this.rrHistory.slice(-10)
        const avgRR = recentRRs.reduce((a, b) => a + b, 0) / recentRRs.length
        const isPremature = currentRR < avgRR * 0.85
        
        if (analysis.confidence < 0.1 && !isPremature && peak.amplitude < 500 && qrsWidth < 90) {
          this.storeNormalTemplate(data, peak.index)
        }
      }
    }
  }

  // ADD: Smart learning mode handler
  private handleLearningMode(peak: { time: number; index: number; amplitude: number }, data: number[], qrsWidth: number) {
    this.learningBeatCount++
    
    // Store this beat for analysis (now includes QRS width)
    this.learningBeats.push({
      data: [...data], // Copy the data
      index: peak.index,
      amplitude: peak.amplitude,
      qrsWidth: qrsWidth
    })

    console.log(`🎓 SMART LEARNING: Beat ${this.learningBeatCount}/${this.maxLearningBeats}`)
    
    // Check if we've collected enough learning beats
    if (this.learningBeatCount >= this.maxLearningBeats) {
      this.finalizeLearning()
    }
  }

  // ADD: Use smart morphology trainer
  private finalizeLearning() {
    console.log('🎓 SMART LEARNING COMPLETE - Finding dominant morphology...')
    
    // Use the smart trainer to find dominant morphology
    this.trainingResult = this.morphologyTrainer.trainFromBeats(this.learningBeats, this.samplingRate)
    
    if (this.trainingResult.confidence < 0.5) {
      console.log('🚨 WARNING: Low training confidence - using template-free detection')
      this.normalTemplates = [] // Force template-free detection
    } else {
      // Use the smart templates
      this.normalTemplates = this.trainingResult.normalTemplates
      console.log(`🎓 SMART TRAINING SUCCESS:`)
      console.log(`  📊 Clusters found: ${this.trainingResult.clustersFound}`)
      console.log(`  🎯 Normal cluster size: ${this.trainingResult.normalClusterSize}`)
      console.log(`  💪 Confidence: ${(this.trainingResult.confidence * 100).toFixed(1)}%`)
    }

    // Update RR history from learning beats
    this.updateRRHistoryFromLearning()

    // Exit learning mode
    this.isLearningMode = false
    this.learningBeats = [] // Clear memory

    // FIXED: Reset start time so detection starts from 0 seconds
    this.startTime = Date.now()

    console.log('🎓 SMART LEARNING MODE COMPLETE - PVC detection enabled')
    console.log(`🎓 RR History after training: ${this.rrHistory.slice(-10)} (length: ${this.rrHistory.length})`)
  }

  // ADD: Update RR history from learning period
  private updateRRHistoryFromLearning() {
    if (this.rPeaks.length < 2) return
    
    const learningRRs: number[] = []
    for (let i = 1; i < Math.min(this.rPeaks.length, this.learningBeatCount + 1); i++) {
      learningRRs.push(this.rPeaks[i] - this.rPeaks[i - 1])
    }
    
    this.rrHistory = learningRRs
    console.log(`🎓 Initialized RR history with ${learningRRs.length} intervals`)
  }

  private analyzeBeat(peak: { time: number; index: number; amplitude: number }, data: number[], qrsWidth: number) {
    // FIXED: Check if rrHistory is empty before accessing
    if (this.rrHistory.length === 0) {
      return {
        isPVC: false,
        currentRR: 0,
        expectedRR: 0,
        percentagePremature: 0,
        confidence: 0,
        morphologyScore: 0,
        pathway: 'high-amplitude' as PVCEvent['detectionPathway']
      }
    }

    const currentRR = this.rrHistory[this.rrHistory.length - 1]
    const nextRR = this.rrHistory.length > 1 ? this.rrHistory[this.rrHistory.length - 2] : currentRR
    
    // FIXED: Use more robust statistics with filtering
    const recentRRs = this.rrHistory.slice(-20)
    const normalRRs = recentRRs.filter(rr => rr > 500 && rr < 1200)
    let expectedRR: number
    if (normalRRs.length === 0) {
      expectedRR = 800 // Default
    } else {
      const sortedRRs = [...normalRRs].sort((a, b) => a - b)
      expectedRR = sortedRRs[Math.floor(sortedRRs.length / 2)]
    }
    
    console.log(`🔍 RR DEBUG - Current: ${currentRR}ms, Expected: ${expectedRR}ms, History length: ${this.rrHistory.length}`)
    
    // FIXED morphology scoring - only dissimilarity from normal
    const morphologyScore = this.calculateSimpleMorphology(data, peak.index)
    console.log(`🔬 MORPH DEBUG - Score: ${morphologyScore.toFixed(3)}, Amplitude: ${peak.amplitude}, QRS: ${qrsWidth}`)
    
    // **SIMPLE FIX: Morphology-only detection for obvious PVCs**
    if (morphologyScore > 0.7) {
      return {
        isPVC: true,
        currentRR,
        expectedRR,
        percentagePremature: Math.round((1 - currentRR / expectedRR) * 100),
        confidence: Math.min(0.9, morphologyScore),
        morphologyScore,
        pathway: 'morphology-only' as PVCEvent['detectionPathway']
      }
    }
    
    // **SIMPLIFIED 4-PATHWAY DETECTION**
    
    // Pathway 1: High-amplitude PVCs (your original working method)
    const isHighAmplitude = peak.amplitude > 600
    const isVeryHighAmplitude = peak.amplitude > 800
    
    // Pathway 2: Wide QRS
    const isWide = qrsWidth > 120 // Keep standard threshold
    
    // FIXED: More sensitive premature detection for bigeminy
    const isPremature = currentRR < expectedRR * 0.80        // Changed from 0.90 to 0.80
    const isVeryPremature = currentRR < expectedRR * 0.70    // Changed from 0.80 to 0.70  
    const isModeratelyPremature = currentRR < expectedRR * 0.85 // Changed from 0.95 to 0.85
    
    // Pathway 4: Compensatory Pause Detection (NEW - for missed PVCs)
    const hasCompensatoryPause = nextRR > expectedRR * 1.25 // 25% longer than expected
    
    // FIXED: Lower morphology thresholds for similar PVCs
    const hasAbnormalMorphology = morphologyScore > 0.12 // Changed from 0.25 to 0.12
    const hasModerateAbnormalMorphology = morphologyScore > 0.08 // Changed from 0.15 to 0.08
    
    if (morphologyScore > 0.5) {
        console.log(`🚨 HIGH MORPH SCORE: ${morphologyScore.toFixed(3)} - QRS: ${qrsWidth}ms, AMP: ${peak.amplitude}μV`)
        console.log(`🚨 Premature tests: isPremature=${isPremature}, isVeryPremature=${isVeryPremature}`)
    }
    
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
    
    // Pathway 4: Compensatory Pause Detection (NEW - catches missed PVCs)
    else if (hasCompensatoryPause && isModeratelyPremature) {
      isPVC = true
      pathway = 'premature-morph'
      confidence = 0.6
      
      // Boost confidence if also has abnormal morphology
      if (hasModerateAbnormalMorphology) {
        confidence = 0.75
      }
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
    const searchWindow = Math.floor(this.samplingRate * 0.1) // Increased from 0.08 to 0.1 (100ms)
    const start = Math.max(0, peakIndex - searchWindow)
    const end = Math.min(data.length, peakIndex + searchWindow)
    
    const baseline = this.calculateLocalBaseline(data, peakIndex)
    const peakAmplitude = Math.abs(data[peakIndex] - baseline)
    const threshold = peakAmplitude * 0.15 // Increased from 0.1 to 0.15 (more lenient)
    
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

  // FIXED: Only include normal-to-normal RR intervals
  private updateRRHistory() {
    if (this.rPeaks.length < 2) return
    
    const newRRs: number[] = []
    for (let i = 1; i < this.rPeaks.length; i++) {
      const rrInterval = this.rPeaks[i] - this.rPeaks[i - 1]
      const currentTime = this.rPeaks[i]
      const prevTime = this.rPeaks[i - 1]
      
      // Check if either beat was a PVC
      const currentBeatIsPVC = this.pvcEvents.some(pvc => 
        Math.abs(pvc.timestamp - currentTime) < 100
      )
      const prevBeatIsPVC = this.pvcEvents.some(pvc => 
        Math.abs(pvc.timestamp - prevTime) < 100
      )
      
      // Only include normal-to-normal RR intervals
      if (!currentBeatIsPVC && !prevBeatIsPVC && rrInterval > 400 && rrInterval < 1500) {
        newRRs.push(rrInterval)
      }
    }
    
    // Keep some old normal RRs for stability
    if (newRRs.length > 0) {
      this.rrHistory = [...this.rrHistory.slice(-15), ...newRRs].slice(-30)
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

    // Combine direct and inferred PVC events for result
    const allPvcEvents = [...this.pvcEvents, ...this.inferredPvcEvents]
      .sort((a, b) => a.timestamp - b.timestamp) // Sort by timestamp

    return {
      pvcCount: this.isLearningMode ? 0 : this.pvcCount, // FIXED: Don't count PVCs during training
      totalBeats: this.isLearningMode ? 0 : this.totalDetectedBeats, // FIXED: Don't count beats during training
      detectedBeats: this.isLearningMode ? 0 : this.totalDetectedBeats, // FIXED: Don't count beats during training
      heartRate: this.isLearningMode ? 0 : heartRate, // FIXED: Don't show HR during training
      isPVC: false,
      pvcEvents: this.isLearningMode ? [] : allPvcEvents, // FIXED: Don't show PVCs during training
      timeSpanMs,
      signalQuality: this.calculateSignalQuality()
    }
  }
  resetCounters(): void {
    // Only reset detection counters, keep training data intact
    this.pvcCount = 0
    this.pvcEvents = []
    this.inferredPvcEvents = []
    this.totalDetectedBeats = 0
    this.startTime = Date.now() // Reset timing for fresh burden calculation
    
    console.log('🔄 Detection counters reset - Training data preserved')
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
    this.inferredPvcEvents = [] // NEW: Reset inferred events
    this.startTime = 0
    this.totalDetectedBeats = 0
    
    // ADD: Reset smart learning mode
    this.isLearningMode = true
    this.learningBeatCount = 0
    this.learningBeats = []
    this.trainingResult = null
    
    console.log('🎓 PVC Detector reset - Learning mode enabled')
  }
}