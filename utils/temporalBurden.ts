// utils/temporalBurden.ts - 5-Minute Sliding Window Burden Calculator

import { BeatRecord } from './beatHistory';
import { BurdenCalculator } from './burden'; // ✅ Import the shared burden logic

export interface BurdenDataPoint {
  timestamp: number;
  burden: number; // Percentage 0-100
  windowSizeMinutes: number;
  confidence: number;
  totalBeats: number;
  pvcCount: number;
}

export class TemporalBurdenCalculator {
  private windowSizeMs = 5 * 60 * 1000; // 5 minutes
  private burdenHistory: BurdenDataPoint[] = [];

  calculateSlidingBurden(allBeats: BeatRecord[], currentTime: number): BurdenDataPoint {
    // Look back 5 minutes from current time
    const windowStart = currentTime - this.windowSizeMs;
    const beatsInWindow = allBeats.filter(beat =>
      beat.timestamp >= windowStart && beat.timestamp <= currentTime
    );

    const totalBeats = beatsInWindow.length;
    const pvcCount = beatsInWindow.filter(beat => beat.isPVC).length;

    const averageHR = totalBeats > 0
      ? (60000 * totalBeats) / this.windowSizeMs // beats per minute
      : 0;

    // ✅ Use the shared burden calculation logic
    const stats = BurdenCalculator.calculateBurden(
      totalBeats,
      pvcCount,
      this.windowSizeMs,
      averageHR
    );

    const dataPoint: BurdenDataPoint = {
      timestamp: currentTime,
      burden: stats.burden,
      windowSizeMinutes: 5,
      confidence: stats.confidence,
      totalBeats: stats.totalBeats,
      pvcCount: stats.pvcBeats
    };

    return dataPoint;
  }

  addBurdenPoint(dataPoint: BurdenDataPoint) {
    this.burdenHistory.push(dataPoint);

    // Keep only last 2 hours of burden data
    const cutoffTime = dataPoint.timestamp - (2 * 60 * 60 * 1000);
    this.burdenHistory = this.burdenHistory.filter(point =>
      point.timestamp >= cutoffTime
    );
  }

  getBurdenHistory(): BurdenDataPoint[] {
    return this.burdenHistory;
  }

  getBurdenHistoryForTimeRange(startTime: number, endTime: number): BurdenDataPoint[] {
    return this.burdenHistory.filter(point =>
      point.timestamp >= startTime && point.timestamp <= endTime
    );
  }

  getLatestBurden(): BurdenDataPoint | null {
    return this.burdenHistory.length > 0 ?
      this.burdenHistory[this.burdenHistory.length - 1] : null;
  }

  clear() {
    this.burdenHistory = [];
  }

  // ✅ No longer needed, but you can keep or remove it
  private calculateConfidence(totalBeats: number): number {
    if (totalBeats >= 200) return 0.9;
    if (totalBeats >= 100) return 0.7;
    if (totalBeats >= 50) return 0.5;
    if (totalBeats >= 20) return 0.3;
    return 0.1;
  }

  static getBurdenColor(burden: number): string {
    if (burden < 1) return 'text-green-400';
    if (burden < 10) return 'text-yellow-400';
    return 'text-red-400';
  }
}
