'use client'

import ECGChart from '@/components/ECGChart'
import { useState } from 'react'


export default function Home() {
  const [isConnected, setIsConnected] = useState(false)

  const handleConnectionChange = (connected: boolean) => {
    setIsConnected(connected)
  }

  return (
    <div className="space-y-6">
      {/* Always show ECG Chart - it handles its own connection */}
      <ECGChart 
        isConnected={isConnected} 
        onConnectionChange={handleConnectionChange}
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
              <h4 className="font-semibold mb-2">PVC Detection</h4>
              <p className="text-sm text-gray-400">Real-time detection and counting of arrhythmias using TypeScript analysis</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-3xl mb-3">🎛️</div>
              <h4 className="font-semibold mb-2">Interactive Controls</h4>
              <p className="text-sm text-gray-400">Navigate through data, adjust scales, and monitor in real-time</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}