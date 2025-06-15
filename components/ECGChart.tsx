'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
)

interface ECGChartProps {
  isConnected: boolean
  onConnectionChange: (connected: boolean) => void
}

export default function ECGChart({ isConnected, onConnectionChange }: ECGChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  
  const [allEcgData, setAllEcgData] = useState<number[]>([])
  const [allTimeData, setAllTimeData] = useState<number[]>([])
  const [currentViewStart, setCurrentViewStart] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  
  // ECG Controls
  const [mmPerSecond, setMmPerSecond] = useState(25)
  const [mmPerMv, setMmPerMv] = useState(10)
  const [timeWindow, setTimeWindow] = useState(10)
  
  // Statistics
  const [heartRate, setHeartRate] = useState(0)
  const [pvcCount, setPvcCount] = useState(0)
  const [sampleCount, setSampleCount] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')

  // Simple heart rate estimation
  const estimateHeartRate = (ecgData: number[]): number => {
    if (ecgData.length < 300) return 0
    
    try {
      const data = ecgData.slice(-650) // Last 5 seconds
      const mean = data.reduce((a, b) => a + b, 0) / data.length
      const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length
      const std = Math.sqrt(variance)
      const threshold = mean + 1.2 * std
      
      const peaks: number[] = []
      const minDistance = Math.floor(0.4 * 130) // 130 Hz sampling rate
      
      for (let i = minDistance; i < data.length - minDistance; i++) {
        if (data[i] > data[i-1] && data[i] > data[i+1] && data[i] > threshold) {
          if (peaks.length === 0 || (i - peaks[peaks.length - 1] >= minDistance)) {
            peaks.push(i)
          }
        }
      }
      
      if (peaks.length >= 3) {
        const intervals: number[] = []
        for (let i = 1; i < peaks.length; i++) {
          intervals.push((peaks[i] - peaks[i-1]) / 130)
        }
        
        const sortedIntervals = [...intervals].sort((a, b) => a - b)
        const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)]
        const hr = 60.0 / medianInterval
        
        return (hr >= 40 && hr <= 180) ? hr : 0
      }
      
      return 0
    } catch {
      return 0
    }
  }

  // WebSocket connection - SIMPLE VERSION
  useEffect(() => {
    let ws: WebSocket | null = null

    const connectWebSocket = () => {
      ws = new WebSocket('ws://localhost:8765')
      websocketRef.current = ws

      ws.onopen = () => {
        console.log('✅ WebSocket connected to Python server')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'ecg_data') {
            const newSamples = data.samples as number[]
            const newTimes = data.times as number[]
            
            // Update ECG data
            setAllEcgData(prev => {
              const maxSamples = 130 * 300
              const updatedData = [...prev, ...newSamples]
              return updatedData.length > maxSamples ? updatedData.slice(-maxSamples) : updatedData
            })
            
            // Update time data and handle auto-scroll
            setAllTimeData(prev => {
              const maxSamples = 130 * 300
              const updatedTimes = [...prev, ...newTimes]
              const finalTimes = updatedTimes.length > maxSamples ? updatedTimes.slice(-maxSamples) : updatedTimes
              
              // Auto-scroll if enabled
              if (autoScroll && finalTimes.length > 0) {
                setCurrentViewStart(Math.max(0, finalTimes[finalTimes.length - 1] - timeWindow))
              }
              
              return finalTimes
            })
            
            setSampleCount(prev => prev + newSamples.length)
            
            // Estimate heart rate
            if (allEcgData.length > 500) {
              const hr = estimateHeartRate([...allEcgData, ...newSamples])
              if (hr > 0) setHeartRate(hr)
            }
            
          } else if (data.type === 'status') {
            const connected = data.connected as boolean
            onConnectionChange(connected)
            setConnectionStatus(connected ? 'connected' : 'disconnected')
            
          } else if (data.type === 'error') {
            console.error('❌ Server error:', data.message)
            setConnectionStatus('disconnected')
          }
          
        } catch (error) {
          console.error('❌ WebSocket message error:', error)
        }
      }

      ws.onclose = () => {
        console.log('📡 WebSocket disconnected')
      }

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error)
      }
    }

    connectWebSocket()

    // Cleanup function
    return () => {
      if (ws) {
        ws.close()
      }
    }
  }, [autoScroll, timeWindow, onConnectionChange])

  // Send commands to Python server
  const sendCommand = (command: string) => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ command }))
    }
  }

  const handleConnect = () => {
    setConnectionStatus('connecting')
    sendCommand('connect')
  }

  const handleDisconnect = () => {
    sendCommand('disconnect')
  }

  // Get visible data based on current view
  const getVisibleData = () => {
    if (allTimeData.length === 0) return { data: [], times: [] }
    
    const viewEnd = currentViewStart + timeWindow
    const startIndex = allTimeData.findIndex(time => time >= currentViewStart)
    const endIndex = allTimeData.findIndex(time => time > viewEnd)
    
    const actualStartIndex = Math.max(0, startIndex === -1 ? 0 : startIndex)
    const actualEndIndex = endIndex === -1 ? allTimeData.length : endIndex
    
    return {
      data: allEcgData.slice(actualStartIndex, actualEndIndex),
      times: allTimeData.slice(actualStartIndex, actualEndIndex)
    }
  }

  const visibleData = getVisibleData()

  // Navigation functions
  const scrollLeft = () => {
    setAutoScroll(false)
    setCurrentViewStart(prev => Math.max(0, prev - timeWindow * 0.5))
  }

  const scrollRight = () => {
    setAutoScroll(false)
    if (allTimeData.length > 0) {
      const maxStart = Math.max(0, allTimeData[allTimeData.length - 1] - timeWindow)
      setCurrentViewStart(prev => Math.min(maxStart, prev + timeWindow * 0.5))
    }
  }

  const goToLive = () => {
    setAutoScroll(true)
    if (allTimeData.length > 0) {
      setCurrentViewStart(Math.max(0, allTimeData[allTimeData.length - 1] - timeWindow))
    }
  }

  const goToStart = () => {
    setAutoScroll(false)
    setCurrentViewStart(0)
  }

  // Chart configuration
  const chartData = {
    labels: visibleData.times.map((t, i) => i),
    datasets: [
      {
        label: 'ECG',
        data: visibleData.data,
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
      },
    ],
  }

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        type: 'linear' as const,
        position: 'bottom' as const,
        title: {
          display: true,
          text: 'Time (seconds)',
          color: '#ffffff',
        },
        ticks: {
          color: '#ffffff',
          maxTicksLimit: 10,
          callback: function(value) {
            const index = Number(value)
            const time = visibleData.times[index]
            return time ? time.toFixed(1) : ''
          }
        },
        grid: {
          color: '#f97316',
          lineWidth: 0.5,
        },
      },
      y: {
        title: {
          display: true,
          text: 'Amplitude (μV)',
          color: '#ffffff',
        },
        ticks: {
          color: '#ffffff',
        },
        grid: {
          color: '#f97316',
          lineWidth: 0.5,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    interaction: {
      intersect: false,
    },
  }

  const canScrollLeft = currentViewStart > 0
  const canScrollRight = allTimeData.length > 0 && currentViewStart < allTimeData[allTimeData.length - 1] - timeWindow

  return (
    <div className="w-full">
      {/* Status Bar */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap justify-between items-center text-sm">
          <div className="flex items-center space-x-4">
            <span className={`text-lg ${
              connectionStatus === 'connected' ? 'text-green-400' : 
              connectionStatus === 'connecting' ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {connectionStatus === 'connected' ? '●' : 
               connectionStatus === 'connecting' ? '◐' : '○'} 
              {connectionStatus === 'connected' ? 'Connected' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
            <span>❤️ {heartRate > 0 ? heartRate.toFixed(0) : '--'} BPM</span>
            <span>⚡ PVCs: {pvcCount}</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>Samples: {sampleCount.toLocaleString()}</span>
            <span>{mmPerSecond}mm/s</span>
            <span>{mmPerMv}mm/mV</span>
            <span>130Hz</span>
            <span className={`${autoScroll ? 'text-red-400' : 'text-yellow-400'}`}>
              {autoScroll ? '🔴 AUTO-SCROLL' : '📊 MANUAL'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={goToStart}
              disabled={currentViewStart === 0}
              className="px-3 py-2 bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              ⏮️ Start
            </button>
            <button
              onClick={scrollLeft}
              disabled={!canScrollLeft}
              className="px-3 py-2 bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              ⏪ Back
            </button>
            <button
              onClick={scrollRight}
              disabled={!canScrollRight}
              className="px-3 py-2 bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              ⏩ Forward
            </button>
            <button
              onClick={goToLive}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
            >
              🔴 Go Live
            </button>
            <button
              onClick={connectionStatus === 'connected' ? handleDisconnect : handleConnect}
              disabled={connectionStatus === 'connecting'}
              className={`px-3 py-2 rounded transition-colors ${
                connectionStatus === 'connected' 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : connectionStatus === 'connecting'
                  ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {connectionStatus === 'connected' ? '🔌 Disconnect' : 
               connectionStatus === 'connecting' ? '⏳ Connecting...' : '🔗 Connect Polar H10'}
            </button>
          </div>
          
          <div className="text-sm text-gray-400">
            Viewing: {currentViewStart.toFixed(1)}s - {(currentViewStart + timeWindow).toFixed(1)}s
            {allTimeData.length > 0 && ` (Total: ${allTimeData[allTimeData.length - 1].toFixed(1)}s)`}
          </div>
        </div>
      </div>

      {/* ECG Chart */}
      <div className="bg-black rounded-lg border border-gray-700 p-4 mb-4">
        <div style={{ height: '400px' }}>
          <Line ref={chartRef} data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Time Scale Control */}
        <div className="bg-gray-900 rounded-lg p-4">
          <label className="block text-sm font-medium mb-2">📏 Time Scale</label>
          <select 
            value={mmPerSecond} 
            onChange={(e) => setMmPerSecond(Number(e.target.value))}
            className="w-full bg-gray-800 rounded border border-gray-600 px-3 py-2"
          >
            <option value={10}>10 mm/s</option>
            <option value={25}>25 mm/s</option>
            <option value={50}>50 mm/s</option>
          </select>
        </div>

        {/* Voltage Scale Control */}
        <div className="bg-gray-900 rounded-lg p-4">
          <label className="block text-sm font-medium mb-2">📈 Voltage Scale</label>
          <select 
            value={mmPerMv} 
            onChange={(e) => setMmPerMv(Number(e.target.value))}
            className="w-full bg-gray-800 rounded border border-gray-600 px-3 py-2"
          >
            <option value={5}>5 mm/mV</option>
            <option value={10}>10 mm/mV</option>
            <option value={20}>20 mm/mV</option>
          </select>
        </div>

        {/* Time Window Control */}
        <div className="bg-gray-900 rounded-lg p-4">
          <label className="block text-sm font-medium mb-2">⏱️ Time Window</label>
          <select 
            value={timeWindow} 
            onChange={(e) => setTimeWindow(Number(e.target.value))}
            className="w-full bg-gray-800 rounded border border-gray-600 px-3 py-2"
          >
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
          </select>
        </div>

        {/* Sampling Rate Display */}
        <div className="bg-gray-900 rounded-lg p-4">
          <label className="block text-sm font-medium mb-2">🔄 Sample Rate</label>
          <div className="w-full bg-gray-800 rounded border border-gray-600 px-3 py-2 text-gray-400">
            130 Hz (Polar H10)
          </div>
        </div>
      </div>
    </div>
  )
}