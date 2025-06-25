'use client'

import ECGChart from '@/components/ECGChart'
import BurdenChart from '@/components/BurdenChart'
import TrainingDebug from '@/components/TrainingDebug' // ADD: Import TrainingDebug
import { useState, useRef, useCallback } from 'react'
import { BeatHistoryManager } from '@/utils/beatHistory'
import { TemporalBurdenCalculator, BurdenDataPoint } from '@/utils/temporalBurden'

export default function Home() {
  const [isConnected, setIsConnected] = useState(false)
  const [timeRange, setTimeRange] = useState<'last30min' | 'fullSession'>('last30min')
  const [burdenHistory, setBurdenHistory] = useState<BurdenDataPoint[]>([])
  
  const beatHistoryManager = useRef(new BeatHistoryManager())
  const temporalBurdenCalculator = useRef(new TemporalBurdenCalculator())
  const lastBurdenUpdate = useRef(0)
  
  // ADD: Ref to access PVC detector for debug component
  const ecgChartRef = useRef<any>(null)

  const handleConnectionChange = useCallback((connected: boolean) => {
    setIsConnected(connected)
    if (!connected) {
      beatHistoryManager.current.clear()
      temporalBurdenCalculator.current.clear()
      setBurdenHistory([])
    }
  }, [])

const handleBeatDetected = useCallback((timestamp: number, isPVC: boolean) => {
  beatHistoryManager.current.addBeat(timestamp, isPVC)
  console.log('[💓] Beat at', new Date(timestamp).toLocaleTimeString(), '| PVC:', isPVC)
  
  // Update burden every 5 seconds for testing
  const now = Date.now()
  if (now - lastBurdenUpdate.current >= 30000 && beatHistoryManager.current.getTotalBeats() >= 10) {

    console.log('[📊] Updating temporal burden at', new Date(now).toLocaleTimeString())
    
    // Use ECG timestamp for burden calculation
    const allBeats = beatHistoryManager.current.getAllBeats()
    if (allBeats.length > 0) {
      const latestBeatTime = allBeats[allBeats.length - 1].timestamp
      
      // Debug logs with corrected timestamp
      console.log('[🧠] Total beats in 5 min:', allBeats.filter(b => b.timestamp >= latestBeatTime - 5 * 60 * 1000).length)
      console.log('[🧠] PVCs in 5 min:', allBeats.filter(b => b.timestamp >= latestBeatTime - 5 * 60 * 1000 && b.isPVC).length)

      const burdenPoint = temporalBurdenCalculator.current.calculateSlidingBurden(
        allBeats, 
        latestBeatTime  // Use ECG timestamp for calculation
      )
      
      // FIX: Use browser timestamp for chart display
      const burdenPointWithBrowserTime = {
        ...burdenPoint,
        timestamp: now  // Use browser time for chart filtering
      }
      
      temporalBurdenCalculator.current.addBurdenPoint(burdenPointWithBrowserTime)
      setBurdenHistory(temporalBurdenCalculator.current.getBurdenHistory())
      lastBurdenUpdate.current = now
    }
  }
}, [])

  return (
    <div className="space-y-6">
      {/* ADD: Training Debug Component - comment out to disable */}
      <TrainingDebug pvcDetector={ecgChartRef.current?.pvcDetectorRef?.current} />

      {/* Always show ECG Chart - it handles its own connection */}
      <ECGChart 
        ref={ecgChartRef} // ADD: Ref to access PVC detector
        isConnected={isConnected} 
        onConnectionChange={handleConnectionChange}
        onBeatDetected={handleBeatDetected}
      />

      {/* Temporal Burden Chart */}
      <BurdenChart
        burdenHistory={burdenHistory}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        isConnected={isConnected}
      />

      {/* Instructions */}
      {!isConnected && (
        <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-blue-300">📋 Setup Instructions</h3>
          <ol className="space-y-2 text-sm text-gray-300">
            <li>1. Put on your Polar H10 chest strap</li>
            <li>2. Ensure it's properly moistened and positioned</li>
            <li>3. Make sure the Python WebSocket server is running: <code className="bg-gray-800 px-2 py-1 rounded">python ecg_websocket_server.py</code></li>
            <li>4. Click "Connect Polar H10" in the navigation controls above</li>
            <li>5. Wait for device discovery and connection</li>
            <li>6. Start monitoring your heart rhythm with real-time PVC detection!</li>
          </ol>
          
          <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded">
            <h4 className="font-semibold mb-2 text-yellow-300">🐍 Python Server Required</h4>
            <p className="text-sm text-gray-300">
              This app requires the Python WebSocket server to be running. The server handles the Bluetooth connection to your Polar H10 and streams data to this frontend.
            </p>
          </div>
        </div>
      )}

      {/* Connection Info */}
      {isConnected && (
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-green-300">✅ Connected to Polar H10</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-3xl mb-3">📊</div>
              <h4 className="font-semibold mb-2">Real-time ECG</h4>
              <p className="text-sm text-gray-400">Live ECG waveform from your Polar H10 with medical-grade visualization</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-3xl mb-3">⚡</div>
              <h4 className="font-semibold mb-2">Statistical PVC Detection</h4>
              <p className="text-sm text-gray-400">Real-time detection and counting of arrhythmias using TypeScript analysis</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-3xl mb-3">📈</div>
              <h4 className="font-semibold mb-2">Temporal Burden Analysis</h4>
              <p className="text-sm text-gray-400">5-minute sliding window burden analysis to track PVC patterns over time</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}