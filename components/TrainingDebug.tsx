'use client'

import React from 'react'
import { ImprovedPVCDetector } from '@/utils/PVCDetector'

interface TrainingDebugProps {
  pvcDetector: ImprovedPVCDetector
}

export default function TrainingDebug({ pvcDetector }: TrainingDebugProps) {
  // Add null check for pvcDetector
  if (!pvcDetector) {
    return null // Don't render anything if detector not available
  }

  // Get training result from detector (you'll need to expose this)
  const trainingResult = (pvcDetector as any).trainingResult
  const isLearning = (pvcDetector as any).isLearningMode
  const learningCount = (pvcDetector as any).learningBeatCount
  const maxLearning = (pvcDetector as any).maxLearningBeats

  if (!trainingResult && !isLearning) {
    return null
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4 mb-4 border border-yellow-500">
      <h3 className="text-yellow-400 font-semibold mb-3">🔬 Training Debug</h3>
      
      {isLearning ? (
        <div className="text-center">
          <div className="text-lg mb-2">🎓 Morphology Training Ongoing</div>
          <div className="text-sm text-gray-400">Learning your heartbeat...</div>
          <div className="mt-2">
            <div className="bg-gray-700 rounded-full h-2">
              <div 
                className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(learningCount / maxLearning) * 100}%` }}
              />
            </div>
            <div className="text-sm mt-1">{learningCount}/{maxLearning} beats</div>
          </div>
        </div>
      ) : trainingResult ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Clusters Found:</span>
              <div className="font-medium">{trainingResult.clustersFound}</div>
            </div>
            <div>
              <span className="text-gray-400">Normal Cluster Size:</span>
              <div className="font-medium text-green-400">{trainingResult.normalClusterSize}</div>
            </div>
            <div>
              <span className="text-gray-400">Confidence:</span>
              <div className={`font-medium ${
                trainingResult.confidence > 0.8 ? 'text-green-400' :
                trainingResult.confidence > 0.6 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {(trainingResult.confidence * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <span className="text-gray-400">Quality Score:</span>
              <div className={`font-medium ${
                trainingResult.qualityScore > 0.8 ? 'text-green-400' :
                trainingResult.qualityScore > 0.6 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {(trainingResult.qualityScore * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          
          <div>
            <span className="text-gray-400">Templates Created:</span>
            <div className="font-medium">{trainingResult.normalTemplates.length}</div>
          </div>
          
          {trainingResult.confidence < 0.6 && (
            <div className="bg-red-900/20 border border-red-500 rounded p-2 text-red-400 text-sm">
              ⚠️ Low training confidence! May affect PVC detection accuracy.
            </div>
          )}
          
          {trainingResult.clustersFound === 1 && (
            <div className="bg-green-900/20 border border-green-500 rounded p-2 text-green-400 text-sm">
              ✅ Perfect training! Only normal beats detected in learning phase.
            </div>
          )}
          
          {trainingResult.clustersFound > 2 && (
            <div className="bg-yellow-900/20 border border-yellow-500 rounded p-2 text-yellow-400 text-sm">
              ⚠️ Multiple clusters found - possible PVCs or artifacts during training.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}