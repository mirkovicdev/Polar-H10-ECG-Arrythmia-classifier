// utils/burden.ts - PVC Burden Calculator

export interface BurdenStats {
  totalBeats: number;
  normalBeats: number;
  pvcBeats: number;
  burden: number; // Percentage
  burdenCategory: 'low' | 'moderate' | 'high';
}

export class BurdenCalculator {
  
  /**
   * Calculate PVC burden from detection results
   * @param totalBeats - Total R-peaks detected
   * @param pvcCount - Number of PVCs detected
   * @returns Burden statistics
   */
  static calculateBurden(totalBeats: number, pvcCount: number): BurdenStats {
    const normalBeats = Math.max(0, totalBeats - pvcCount);
    const burden = totalBeats > 0 ? (pvcCount / totalBeats) * 100 : 0;
    
    return {
      totalBeats,
      normalBeats,
      pvcBeats: pvcCount,
      burden: Math.round(burden * 10) / 10, // Round to 1 decimal
      burdenCategory: this.categorizeBurden(burden)
    };
  }
  
  /**
   * Categorize PVC burden based on clinical significance
   * @param burden - PVC burden percentage
   * @returns Clinical category
   */
  private static categorizeBurden(burden: number): 'low' | 'moderate' | 'high' {
    if (burden < 5) return 'low';       // <5% - Generally benign
    if (burden < 20) return 'moderate'; // 5-20% - May need monitoring
    return 'high';                      // >20% - Often clinically significant
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
   * Format burden for display
   * @param burden - Burden percentage
   * @returns Formatted string
   */
  static formatBurden(burden: number): string {
    return `${burden.toFixed(1)}%`;
  }
}