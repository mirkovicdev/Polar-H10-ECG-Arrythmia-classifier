// utils/MorphologyTrainer.ts - Smart Training with Dominant Morphology Detection

export interface TrainingBeat {
  data: number[];
  index: number;
  amplitude: number;
  qrsWidth: number;
  normalizedMorphology: number[];
}

export interface MorphologyCluster {
  beats: TrainingBeat[];
  centroid: number[];
  avgCorrelation: number;
  isNormal: boolean;
}

export interface TrainingResult {
  normalTemplates: number[][];
  clustersFound: number;
  normalClusterSize: number;
  confidence: number;
  qualityScore: number;
}

export class MorphologyTrainer {
  private correlationThreshold = 0.7 // Beats with >70% correlation are similar
  private minClusterSize = 3 // Need at least 3 beats to form a cluster
  private beatWindow = 60 // Morphology window around peak

  /**
   * Main training function - finds dominant morphology from collected beats
   */
  public trainFromBeats(
    collectedBeats: { data: number[], index: number, amplitude: number, qrsWidth: number }[],
    samplingRate: number = 130
  ): TrainingResult {
    
    console.log(`🎓 SMART TRAINING: Analyzing ${collectedBeats.length} beats...`)

    // Step 1: Normalize all beats for morphology comparison
    const trainingBeats = this.normalizeBeats(collectedBeats)
    console.log(`📊 Normalized ${trainingBeats.length} beats for clustering`)

    // Step 2: Cluster beats by morphology similarity
    const clusters = this.clusterBeatsByMorphology(trainingBeats)
    console.log(`🔍 Found ${clusters.length} morphology clusters`)

    // Step 3: Identify the dominant (normal) cluster
    const dominantCluster = this.findDominantCluster(clusters)
    
    if (!dominantCluster) {
      console.log('❌ TRAINING FAILED: No clear dominant morphology found')
      return {
        normalTemplates: [],
        clustersFound: clusters.length,
        normalClusterSize: 0,
        confidence: 0,
        qualityScore: 0
      }
    }

    // Step 4: Generate templates from dominant cluster
    const templates = this.generateTemplatesFromCluster(dominantCluster)
    
    const confidence = this.calculateTrainingConfidence(dominantCluster, clusters)
    const qualityScore = this.calculateQualityScore(dominantCluster)

    console.log(`✅ TRAINING SUCCESS:`)
    console.log(`  📈 Dominant cluster: ${dominantCluster.beats.length} beats`)
    console.log(`  🎯 Templates created: ${templates.length}`)
    console.log(`  💪 Confidence: ${(confidence * 100).toFixed(1)}%`)
    console.log(`  ⭐ Quality: ${(qualityScore * 100).toFixed(1)}%`)

    return {
      normalTemplates: templates,
      clustersFound: clusters.length,
      normalClusterSize: dominantCluster.beats.length,
      confidence,
      qualityScore
    }
  }

  /**
   * Normalize beats for morphology comparison
   */
  private normalizeBeats(
    beats: { data: number[], index: number, amplitude: number, qrsWidth: number }[]
  ): TrainingBeat[] {
    return beats.map(beat => {
      // Extract morphology window around peak
      const start = Math.max(0, beat.index - this.beatWindow)
      const end = Math.min(beat.data.length, beat.index + this.beatWindow)
      const morphology = beat.data.slice(start, end)

      // Normalize amplitude
      const maxAmp = Math.max(...morphology.map(Math.abs))
      const normalizedMorphology = maxAmp > 0 
        ? morphology.map(x => x / maxAmp)
        : morphology

      return {
        data: beat.data,
        index: beat.index,
        amplitude: beat.amplitude,
        qrsWidth: beat.qrsWidth,
        normalizedMorphology
      }
    }).filter(beat => beat.normalizedMorphology.length > 20) // Ensure sufficient data
  }

  /**
   * Cluster beats by morphology similarity using correlation
   */
  private clusterBeatsByMorphology(beats: TrainingBeat[]): MorphologyCluster[] {
    const clusters: MorphologyCluster[] = []
    const assigned = new Set<number>()

    for (let i = 0; i < beats.length; i++) {
      if (assigned.has(i)) continue

      // Start new cluster with this beat
      const clusterBeats: TrainingBeat[] = [beats[i]]
      assigned.add(i)

      // Find similar beats
      for (let j = i + 1; j < beats.length; j++) {
        if (assigned.has(j)) continue

        const correlation = this.calculateCorrelation(
          beats[i].normalizedMorphology,
          beats[j].normalizedMorphology
        )

        if (correlation > this.correlationThreshold) {
          clusterBeats.push(beats[j])
          assigned.add(j)
        }
      }

      // Only keep clusters with minimum size
      if (clusterBeats.length >= this.minClusterSize) {
        const centroid = this.calculateCentroid(clusterBeats)
        const avgCorrelation = this.calculateAvgIntraClusterCorrelation(clusterBeats)

        clusters.push({
          beats: clusterBeats,
          centroid,
          avgCorrelation,
          isNormal: false // Will be determined later
        })
      }
    }

    return clusters.sort((a, b) => b.beats.length - a.beats.length) // Sort by size
  }

  /**
   * Find the dominant cluster (likely normal beats)
   */
  private findDominantCluster(clusters: MorphologyCluster[]): MorphologyCluster | null {
    if (clusters.length === 0) return null

    // The largest cluster is usually the normal beats
    const largest = clusters[0]
    
    // Additional validation: should be at least 40% of all beats
    const totalBeats = clusters.reduce((sum, c) => sum + c.beats.length, 0)
    const dominanceRatio = largest.beats.length / totalBeats

    if (dominanceRatio < 0.4) {
      console.log(`⚠️ Largest cluster only ${(dominanceRatio * 100).toFixed(1)}% - may not be reliable`)
    }

    // Mark as normal and return
    largest.isNormal = true
    return largest
  }

  /**
   * Generate templates from the dominant cluster
   */
  private generateTemplatesFromCluster(cluster: MorphologyCluster): number[][] {
    const templates: number[][] = []

    // Use the centroid as primary template
    templates.push([...cluster.centroid])

    // Add a few representative beats (highest correlation with centroid)
    const representatives = cluster.beats
      .map(beat => ({
        beat,
        correlation: this.calculateCorrelation(beat.normalizedMorphology, cluster.centroid)
      }))
      .sort((a, b) => b.correlation - a.correlation)
      .slice(0, 5) // Top 5 most representative

    representatives.forEach(({ beat }) => {
      templates.push([...beat.normalizedMorphology])
    })

    return templates
  }

  /**
   * Calculate centroid (average morphology) of a cluster
   */
  private calculateCentroid(beats: TrainingBeat[]): number[] {
    if (beats.length === 0) return []

    const maxLength = Math.max(...beats.map(b => b.normalizedMorphology.length))
    const centroid: number[] = new Array(maxLength).fill(0)

    for (let i = 0; i < maxLength; i++) {
      let sum = 0
      let count = 0

      beats.forEach(beat => {
        if (i < beat.normalizedMorphology.length) {
          sum += beat.normalizedMorphology[i]
          count++
        }
      })

      centroid[i] = count > 0 ? sum / count : 0
    }

    return centroid
  }

  /**
   * Calculate average correlation within a cluster
   */
  private calculateAvgIntraClusterCorrelation(beats: TrainingBeat[]): number {
    if (beats.length < 2) return 1

    let totalCorrelation = 0
    let comparisons = 0

    for (let i = 0; i < beats.length; i++) {
      for (let j = i + 1; j < beats.length; j++) {
        totalCorrelation += this.calculateCorrelation(
          beats[i].normalizedMorphology,
          beats[j].normalizedMorphology
        )
        comparisons++
      }
    }

    return comparisons > 0 ? totalCorrelation / comparisons : 0
  }

  /**
   * Calculate training confidence based on cluster quality
   */
  private calculateTrainingConfidence(
    dominantCluster: MorphologyCluster,
    allClusters: MorphologyCluster[]
  ): number {
    const totalBeats = allClusters.reduce((sum, c) => sum + c.beats.length, 0)
    const dominanceRatio = dominantCluster.beats.length / totalBeats
    const intraCorrelation = dominantCluster.avgCorrelation

    // High confidence if: large dominant cluster + high internal correlation
    return Math.min(1, dominanceRatio * intraCorrelation * 1.2)
  }

  /**
   * Calculate overall quality score
   */
  private calculateQualityScore(cluster: MorphologyCluster): number {
    // Quality based on: cluster size, internal correlation, morphology consistency
    const sizeScore = Math.min(1, cluster.beats.length / 20) // Ideal: 20+ beats
    const correlationScore = cluster.avgCorrelation
    
    // Check QRS width consistency
    const qrsWidths = cluster.beats.map(b => b.qrsWidth)
    const avgQRS = qrsWidths.reduce((a, b) => a + b, 0) / qrsWidths.length
    const qrsVariance = qrsWidths.reduce((sum, w) => sum + Math.pow(w - avgQRS, 2), 0) / qrsWidths.length
    const qrsConsistency = Math.max(0, 1 - qrsVariance / 100) // Lower variance = higher consistency

    return (sizeScore + correlationScore + qrsConsistency) / 3
  }

  /**
   * Calculate correlation between two morphology vectors
   */
  private calculateCorrelation(morph1: number[], morph2: number[]): number {
    const minLength = Math.min(morph1.length, morph2.length)
    if (minLength < 10) return 0

    const m1 = morph1.slice(0, minLength)
    const m2 = morph2.slice(0, minLength)

    const mean1 = m1.reduce((a, b) => a + b, 0) / m1.length
    const mean2 = m2.reduce((a, b) => a + b, 0) / m2.length

    let numerator = 0
    let sum1 = 0
    let sum2 = 0

    for (let i = 0; i < minLength; i++) {
      const diff1 = m1[i] - mean1
      const diff2 = m2[i] - mean2
      numerator += diff1 * diff2
      sum1 += diff1 * diff1
      sum2 += diff2 * diff2
    }

    const denominator = Math.sqrt(sum1 * sum2)
    return denominator === 0 ? 0 : numerator / denominator
  }
}