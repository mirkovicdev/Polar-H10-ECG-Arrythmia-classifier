// utils/burden.ts - Improved PVC Burden Calculator

export interface BurdenStats {
  totalBeats: number;
  normalBeats: number;
  pvcBeats: number;
  burden: number; // Percentage
  burdenCategory: 'low' | 'moderate' | 'high';
  confidence: number;
  timeWindow: number; // Time window in minutes
  averageHeartRate: number;
}

export class BurdenCalculator {
  
  /**
   * Calculate PVC burden from detection results - FIXED VERSION
   * @param detectedBeats - ACTUAL R-peaks detected (not calculated)
   * @param pvcCount - Number of PVCs detected
   * @param timeSpanMs - Actual time span of recording
   * @param heartRate - Current heart rate for confidence calculation
   * @returns Accurate burden statistics
   */
  static calculateBurden(
    detectedBeats: number, 
    pvcCount: number, 
    timeSpanMs: number = 0,
    heartRate: number = 0
  ): BurdenStats {
    // Use ACTUAL detected beats, not calculated expected beats
    const totalBeats = detectedBeats;
    const normalBeats = Math.max(0, totalBeats - pvcCount);
    const burden = totalBeats > 0 ? (pvcCount / totalBeats) * 100 : 0;
    
    // Calculate confidence based on detection quality
    const timeWindowMinutes = timeSpanMs / (1000 * 60);
    const confidence = this.calculateConfidence(totalBeats, timeWindowMinutes, heartRate);
    
    return {
      totalBeats,
      normalBeats,
      pvcBeats: pvcCount,
      burden: Math.round(burden * 100) / 100, // Round to 2 decimals for precision
      burdenCategory: this.categorizeBurden(burden),
      confidence,
      timeWindow: timeWindowMinutes,
      averageHeartRate: heartRate
    };
  }
  
  /**
   * Calculate confidence in burden measurement
   * @param totalBeats - Total beats detected
   * @param timeWindowMinutes - Recording duration in minutes
   * @param heartRate - Average heart rate
   * @returns Confidence score 0-1
   */
  private static calculateConfidence(
    totalBeats: number, 
    timeWindowMinutes: number, 
    heartRate: number
  ): number {
    let confidence = 0;
    
    // Time window factor (longer = more confident)
    if (timeWindowMinutes >= 30) confidence += 0.4;
    else if (timeWindowMinutes >= 10) confidence += 0.3;
    else if (timeWindowMinutes >= 5) confidence += 0.2;
    else if (timeWindowMinutes >= 1) confidence += 0.1;
    
    // Beat count factor
    if (totalBeats >= 3000) confidence += 0.3; // ~30+ minutes of data
    else if (totalBeats >= 1000) confidence += 0.2; // ~10+ minutes
    else if (totalBeats >= 300) confidence += 0.1;  // ~3+ minutes
    
    // Heart rate stability factor
    if (heartRate >= 50 && heartRate <= 120) confidence += 0.2; // Normal range
    else if (heartRate > 0) confidence += 0.1; // At least we have HR data
    
    // Detection quality factor (based on expected vs actual beats)
    if (heartRate > 0 && timeWindowMinutes > 0) {
      const expectedBeats = (heartRate * timeWindowMinutes);
      const detectionRatio = totalBeats / expectedBeats;
      
      // Good detection if we're getting 80-120% of expected beats
      if (detectionRatio >= 0.8 && detectionRatio <= 1.2) {
        confidence += 0.1;
      }
    }
    
    return Math.min(1, confidence);
  }
  
  /**
   * Categorize PVC burden based on clinical significance
   * @param burden - PVC burden percentage
   * @returns Clinical category
   */
  private static categorizeBurden(burden: number): 'low' | 'moderate' | 'high' {
    // Updated clinical thresholds based on recent research
    if (burden < 1) return 'low';        // <1% - Very low, likely benign
    if (burden < 10) return 'moderate';  // 1-10% - Moderate, monitor for symptoms
    return 'high';                       // >10% - High, often clinically significant
  }
  
  /**
   * Get display color for burden category
   * @param category - Burden category
   * @returns Tailwind color class
   */
  static getBurdenColor(category: 'low' | 'moderate' | 'high'): string {
    switch (category) {
      case 'low': return 'text-green-400';
      case 'moderate': return 'text-yellow-400';
      case 'high': return 'text-red-400';
    }
  }
  
  /**
   * Get confidence color for display
   * @param confidence - Confidence score 0-1
   * @returns Tailwind color class
   */
  static getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    if (confidence >= 0.4) return 'text-orange-400';
    return 'text-red-400';
  }
  
  /**
   * Format burden for display with confidence indicator
   * @param burden - Burden percentage
   * @param confidence - Confidence score
   * @returns Formatted string
   */
  static formatBurden(burden: number, confidence: number = 1): string {
    const burdenStr = burden.toFixed(2) + '%';
    const confidenceIndicator = this.getConfidenceIndicator(confidence);
    return `${burdenStr} ${confidenceIndicator}`;
  }
  
  /**
   * Get confidence indicator symbol
   * @param confidence - Confidence score 0-1
   * @returns Symbol representing confidence level
   */
  private static getConfidenceIndicator(confidence: number): string {
    if (confidence >= 0.8) return '●●●'; // High confidence
    if (confidence >= 0.6) return '●●○'; // Medium confidence  
    if (confidence >= 0.4) return '●○○'; // Low confidence
    return '○○○'; // Very low confidence
  }
  
  /**
   * Get clinical interpretation of burden
   * @param burden - PVC burden percentage
   * @param confidence - Confidence score
   * @returns Clinical interpretation string
   */
  static getClinicalInterpretation(burden: number, confidence: number): string {
    const category = this.categorizeBurden(burden);
    
    if (confidence < 0.4) {
      return "Insufficient data for reliable burden assessment";
    }
    
    switch (category) {
      case 'low':
        return burden < 0.1 ? "Minimal PVC activity" : "Low PVC burden - typically benign";
      case 'moderate':
        return "Moderate PVC burden - monitor for symptoms";
      case 'high':
        return "High PVC burden - consider cardiology evaluation";
    }
  }
  
  /**
   * Calculate burden trend over time windows
   * @param burdenHistory - Array of burden measurements over time
   * @returns Trend analysis
   */
  static calculateBurdenTrend(burdenHistory: { burden: number; timestamp: number }[]): {
    trend: 'increasing' | 'decreasing' | 'stable';
    trendValue: number;
    confidence: number;
  } {
    if (burdenHistory.length < 3) {
      return { trend: 'stable', trendValue: 0, confidence: 0 };
    }
    
    // Simple linear regression on recent burden values
    const recentHistory = burdenHistory.slice(-10); // Last 10 measurements
    const n = recentHistory.length;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    recentHistory.forEach((point, index) => {
      sumX += index;
      sumY += point.burden;
      sumXY += index * point.burden;
      sumXX += index * index;
    });
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const confidence = Math.min(1, n / 10); // More confident with more data points
    
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(slope) < 0.1) trend = 'stable';
    else if (slope > 0) trend = 'increasing';
    else trend = 'decreasing';
    
    return {
      trend,
      trendValue: slope,
      confidence
    };
  }
}