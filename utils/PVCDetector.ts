/**
 * PVC Detection Logic - Translated from your pvc.py
 * Detects PVCs/PACs using R-R interval analysis
 */

interface PVCDetection {
  timestamp: number;
  rrInterval: number;
  baselineRr: number;
  type: 'premature' | 'compensatory';
  severity: number;
}

interface PVCStats {
  totalPvcs: number;
  recentPvcs: number;
  lastPvcTime: number | null;
  pvcsPerMinute: number;
  detectionActive: boolean;
}

export class PVCDetector {
  private samplingFreq: number;
  private minRrFactor: number = 0.6;    // Premature beat: RR < 60% of average
  private maxRrFactor: number = 1.5;    // Compensatory pause: RR > 150% of average
  private minHr: number = 40;           // Minimum reasonable heart rate
  private maxHr: number = 180;          // Maximum reasonable heart rate
  
  private detectedPvcs: PVCDetection[] = [];
  private lastAnalysisTime: number = 0;
  private totalPvcCount: number = 0;
  private debugMode: boolean = false;
  
  constructor(samplingFreq: number = 130) {
    this.samplingFreq = samplingFreq;
  }

  /**
   * Detect R-peaks from ECG data (same logic as Python version)
   */
  private detectRPeaks(ecgData: number[], ecgTimes: number[]): { peaks: number[], peakTimes: number[] } {
    if (ecgData.length < 100) {
      return { peaks: [], peakTimes: [] };
    }

    try {
      // Use recent data for better peak detection (last 10 seconds)
      const dataLength = Math.min(1300, ecgData.length);
      const data = ecgData.slice(-dataLength);
      const times = ecgTimes.slice(-dataLength);

      // Peak detection parameters
      const meanVal = data.reduce((a, b) => a + b, 0) / data.length;
      const variance = data.reduce((a, b) => a + Math.pow(b - meanVal, 2), 0) / data.length;
      const stdVal = Math.sqrt(variance);
      const threshold = meanVal + 1.0 * stdVal; // Slightly more sensitive

      // Find peaks with minimum distance
      const peaks: number[] = [];
      const peakTimes: number[] = [];
      const minDistance = Math.floor(0.3 * this.samplingFreq); // 300ms minimum between peaks

      for (let i = minDistance; i < data.length - minDistance; i++) {
        if (data[i] > data[i - 1] && 
            data[i] > data[i + 1] && 
            data[i] > threshold) {
          // Check distance from previous peak
          if (peaks.length === 0 || (i - peaks[peaks.length - 1] >= minDistance)) {
            peaks.push(i);
            peakTimes.push(times[i]);
          }
        }
      }

      return { peaks, peakTimes };
    } catch (error) {
      if (this.debugMode) {
        console.error('❌ Peak detection error:', error);
      }
      return { peaks: [], peakTimes: [] };
    }
  }

  /**
   * Calculate R-R intervals from peak timestamps
   */
  private calculateRrIntervals(peakTimes: number[]): number[] {
    if (peakTimes.length < 2) {
      return [];
    }

    const rrIntervals: number[] = [];
    for (let i = 1; i < peakTimes.length; i++) {
      const interval = peakTimes[i] - peakTimes[i - 1];
      rrIntervals.push(interval);
    }

    return rrIntervals;
  }

  /**
   * Detect PVCs from R-R interval irregularities (same logic as Python)
   */
  private detectPvcsFromRr(rrIntervals: number[], peakTimes: number[]): PVCDetection[] {
    if (rrIntervals.length < 5) {
      return [];
    }

    const pvcsDetected: PVCDetection[] = [];

    try {
      // Calculate baseline R-R interval (exclude outliers)
      const recentIntervals = rrIntervals.slice(-10); // Last 10 intervals
      const sortedIntervals = [...recentIntervals].sort((a, b) => a - b);
      const baselineRr = sortedIntervals[Math.floor(sortedIntervals.length / 2)]; // Median

      // Validate baseline (should correspond to reasonable heart rate)
      const baselineHr = 60.0 / baselineRr;
      if (baselineHr < this.minHr || baselineHr > this.maxHr) {
        return []; // Invalid baseline
      }

      // Look for irregular patterns
      for (let i = 0; i < rrIntervals.length - 1; i++) {
        const currentRr = rrIntervals[i];
        const nextRr = i + 1 < rrIntervals.length ? rrIntervals[i + 1] : null;

        // Check for premature beat pattern
        const isPremature = currentRr < (baselineRr * this.minRrFactor);

        // Check for compensatory pause (if we have next interval)
        const hasCompensatoryPause = nextRr !== null && nextRr > (baselineRr * this.maxRrFactor);

        // PVC/PAC detection criteria
        if (isPremature || hasCompensatoryPause) {
          // Determine beat timestamp (peak that ended this interval)
          const beatTime = i + 1 < peakTimes.length ? peakTimes[i + 1] : peakTimes[i];

          const pvcInfo: PVCDetection = {
            timestamp: beatTime,
            rrInterval: currentRr,
            baselineRr: baselineRr,
            type: isPremature ? 'premature' : 'compensatory',
            severity: Math.abs(currentRr - baselineRr) / baselineRr // How abnormal
          };

          pvcsDetected.push(pvcInfo);

          if (this.debugMode) {
            console.log(`🔍 PVC detected at ${beatTime.toFixed(1)}s: ` +
                       `RR=${currentRr.toFixed(3)}s (baseline=${baselineRr.toFixed(3)}s)`);
          }
        }
      }
    } catch (error) {
      if (this.debugMode) {
        console.error('❌ PVC detection error:', error);
      }
    }

    return pvcsDetected;
  }

  /**
   * Main analysis function - detects PVCs from ECG data
   */
  analyzeEcgForPvcs(ecgData: number[], ecgTimes: number[]): PVCStats {
    const currentTime = Date.now() / 1000; // Convert to seconds

    // Don't analyze too frequently (every 2 seconds max)
    if (currentTime - this.lastAnalysisTime < 2.0) {
      return this.getCurrentStats();
    }

    this.lastAnalysisTime = currentTime;

    // Step 1: Detect R-peaks
    const { peaks, peakTimes } = this.detectRPeaks(ecgData, ecgTimes);

    if (peaks.length < 3) {
      return this.getCurrentStats();
    }

    // Step 2: Calculate R-R intervals
    const rrIntervals = this.calculateRrIntervals(peakTimes);

    if (rrIntervals.length < 2) {
      return this.getCurrentStats();
    }

    // Step 3: Detect PVCs from irregular R-R patterns
    const newPvcs = this.detectPvcsFromRr(rrIntervals, peakTimes);

    // Step 4: Add new PVCs to our tracking (avoid duplicates)
    for (const pvc of newPvcs) {
      // Check if this PVC is too close to an existing one (avoid duplicates)
      const isDuplicate = this.detectedPvcs
        .slice(-10) // Check last 10 PVCs
        .some(existingPvc => Math.abs(pvc.timestamp - existingPvc.timestamp) < 1.0); // Within 1 second

      if (!isDuplicate) {
        this.detectedPvcs.push(pvc);
        this.totalPvcCount++;

        // Keep only last 1000 detections
        if (this.detectedPvcs.length > 1000) {
          this.detectedPvcs = this.detectedPvcs.slice(-1000);
        }

        if (this.debugMode) {
          console.log(`✅ New PVC #${this.totalPvcCount} at ${pvc.timestamp.toFixed(1)}s`);
        }
      }
    }

    return this.getCurrentStats();
  }

  /**
   * Get current PVC detection statistics
   */
  getCurrentStats(): PVCStats {
    const currentTime = Date.now() / 1000;
    const recentPvcs = this.detectedPvcs.filter(
      pvc => currentTime - pvc.timestamp < 300 // Last 5 minutes
    );

    return {
      totalPvcs: this.totalPvcCount,
      recentPvcs: recentPvcs.length,
      lastPvcTime: this.detectedPvcs.length > 0 ? this.detectedPvcs[this.detectedPvcs.length - 1].timestamp : null,
      pvcsPerMinute: recentPvcs.length / 5.0, // PVCs per minute (last 5 min)
      detectionActive: true
    };
  }

  /**
   * Get list of recent PVCs for display
   */
  getRecentPvcList(minutes: number = 5): PVCDetection[] {
    const cutoffTime = (Date.now() / 1000) - (minutes * 60);
    return this.detectedPvcs.filter(pvc => pvc.timestamp > cutoffTime);
  }

  /**
   * Enable/disable debug output
   */
  enableDebug(enabled: boolean = true): void {
    this.debugMode = enabled;
  }

  /**
   * Reset all PVC counts and detections
   */
  resetCounts(): void {
    this.detectedPvcs = [];
    this.totalPvcCount = 0;
    console.log('🔄 PVC counts reset');
  }

  /**
   * Estimate heart rate from ECG data (bonus utility function)
   */
  estimateHeartRate(ecgData: number[]): number {
    try {
      if (ecgData.length < 300) {
        return 0;
      }

      // Use last 5 seconds for more accurate HR
      const data = ecgData.length > 650 ? ecgData.slice(-650) : ecgData;

      // Improved R-peak detection
      const meanVal = data.reduce((a, b) => a + b, 0) / data.length;
      const variance = data.reduce((a, b) => a + Math.pow(b - meanVal, 2), 0) / data.length;
      const stdVal = Math.sqrt(variance);
      const threshold = meanVal + 1.2 * stdVal;

      // Find peaks with minimum distance
      const peaks: number[] = [];
      const minDistance = Math.floor(0.4 * this.samplingFreq); // 0.4 seconds minimum between peaks

      for (let i = minDistance; i < data.length - minDistance; i++) {
        if (data[i] > data[i - 1] && 
            data[i] > data[i + 1] && 
            data[i] > threshold) {
          // Check if this peak is far enough from previous peaks
          if (peaks.length === 0 || (i - peaks[peaks.length - 1] >= minDistance)) {
            peaks.push(i);
          }
        }
      }

      if (peaks.length >= 3) {
        // Calculate intervals between consecutive peaks
        const intervals: number[] = [];
        for (let i = 1; i < peaks.length; i++) {
          const interval = (peaks[i] - peaks[i - 1]) / this.samplingFreq;
          intervals.push(interval);
        }

        if (intervals.length > 0) {
          // Use median for more robust HR calculation
          const sortedIntervals = [...intervals].sort((a, b) => a - b);
          const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];
          const hr = 60.0 / medianInterval;

          // Validate reasonable heart rate range
          if (hr >= 40 && hr <= 180) {
            return hr;
          }
        }
      }

      return 0;
    } catch (error) {
      return 0;
    }
  }
}

export default PVCDetector;