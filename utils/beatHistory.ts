// utils/beatHistory.ts - Simple Beat Storage for Temporal Burden

export interface BeatRecord {
  timestamp: number;
  isPVC: boolean;
  confidence: number;
}

export class BeatHistoryManager {
  private beats: BeatRecord[] = [];

  addBeat(timestamp: number, isPVC: boolean, confidence: number = 1) {
    this.beats.push({
      timestamp,
      isPVC,
      confidence
    });

    // Keep only last 2 hours of data (cleanup)
    const cutoffTime = timestamp - (2 * 60 * 60 * 1000); // 2 hours
    this.beats = this.beats.filter(beat => beat.timestamp >= cutoffTime);
  }

  getBeatsInTimeRange(startTime: number, endTime: number): BeatRecord[] {
    return this.beats.filter(beat => 
      beat.timestamp >= startTime && beat.timestamp <= endTime
    );
  }

  getAllBeats(): BeatRecord[] {
    return this.beats;
  }

  getLatestBeat(): BeatRecord | null {
    return this.beats.length > 0 ? this.beats[this.beats.length - 1] : null;
  }

  clear() {
    this.beats = [];
  }

  getTotalBeats(): number {
    return this.beats.length;
  }

  getPVCCount(): number {
    return this.beats.filter(beat => beat.isPVC).length;
  }
}