'use client'

import React from 'react'
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
import { BurdenDataPoint } from '@/utils/temporalBurden'

// Register Chart.js components (already registered in ECGChart, but need here too)
ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
)

interface BurdenChartProps {
  burdenHistory: BurdenDataPoint[]
  timeRange: 'last30min' | 'fullSession'
  onTimeRangeChange: (range: 'last30min' | 'fullSession') => void
  isConnected: boolean
}

export default function BurdenChart({ 
  burdenHistory, 
  timeRange, 
  onTimeRangeChange,
  isConnected 
}: BurdenChartProps) {

  // Filter data based on time range
  const getVisibleData = () => {
    if (burdenHistory.length === 0) return []
    
    if (timeRange === 'last30min') {
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000)
      return burdenHistory.filter(point => point.timestamp >= thirtyMinutesAgo)
    }
    
    return burdenHistory // Full session
  }

  const visibleData = getVisibleData()

  // Prepare chart data
  const chartData = {
    labels: visibleData.map((_, index) => index),
    datasets: [
      {
        label: 'PVC Burden (%)',
        data: visibleData.map(point => point.burden),
        borderColor: '#ef4444', // Red line
        backgroundColor: 'rgba(239, 68, 68, 0.1)', // Light red fill
        borderWidth: 2,
        pointRadius: 1,
        pointHoverRadius: 4,
        tension: 0.3, // Smooth curves
        fill: true,
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
          text: 'Time',
          color: '#ffffff',
        },
        ticks: {
          color: '#ffffff',
          maxTicksLimit: 8,
          callback: function(value) {
            const index = Number(value)
            if (visibleData[index]) {
              const time = new Date(visibleData[index].timestamp)
              return time.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit' 
              })
            }
            return ''
          }
        },
        grid: {
          color: '#374151',
          lineWidth: 0.5,
        },
      },
      y: {
        min: 0,
        max: 50, // 0-50% range as requested
        title: {
          display: true,
          text: 'PVC Burden (%)',
          color: '#ffffff',
        },
        ticks: {
          color: '#ffffff',
          stepSize: 10,
        },
        grid: {
          color: '#374151',
          lineWidth: 0.5,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: '#1f2937',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: '#ef4444',
        borderWidth: 1,
        callbacks: {
          title: function(context) {
            const index = context[0].dataIndex
            if (visibleData[index]) {
              const time = new Date(visibleData[index].timestamp)
              return time.toLocaleString()
            }
            return ''
          },
          label: function(context) {
            const index = context.dataIndex
            if (visibleData[index]) {
              const point = visibleData[index]
              return [
                `Burden: ${point.burden.toFixed(1)}%`,
                `PVCs: ${point.pvcCount}/${point.totalBeats} beats`,
                `Confidence: ${(point.confidence * 100).toFixed(0)}%`
              ]
            }
            return ''
          }
        }
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
  }

  const latestBurden = visibleData.length > 0 ? visibleData[visibleData.length - 1] : null

  return (
    <div className="w-full">
      {/* Header with controls */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-semibold">📊 Temporal PVC Burden (5-min windows)</h3>
            {latestBurden && (
              <span className={`font-medium ${
                latestBurden.burden < 1 ? 'text-green-400' :
                latestBurden.burden < 10 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                Current: {latestBurden.burden.toFixed(1)}%
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onTimeRangeChange('last30min')}
              className={`px-3 py-2 rounded transition-colors ${
                timeRange === 'last30min' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Last 30min
            </button>
            <button
              onClick={() => onTimeRangeChange('fullSession')}
              className={`px-3 py-2 rounded transition-colors ${
                timeRange === 'fullSession' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Full Session
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-black rounded-lg border border-gray-700 p-4">
        <div style={{ height: '400px' }}>
          {visibleData.length > 0 ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              {isConnected ? 
                'Collecting burden data... (need 5+ minutes for analysis)' : 
                'Connect to Polar H10 to start burden analysis'
              }
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      {visibleData.length > 0 && (
        <div className="bg-gray-900 rounded-lg p-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Data Points:</span>
              <div className="font-medium">{visibleData.length}</div>
            </div>
            <div>
              <span className="text-gray-400">Peak Burden:</span>
              <div className="font-medium text-red-400">
                {Math.max(...visibleData.map(p => p.burden)).toFixed(1)}%
              </div>
            </div>
            <div>
              <span className="text-gray-400">Average Burden:</span>
              <div className="font-medium text-yellow-400">
                {(visibleData.reduce((sum, p) => sum + p.burden, 0) / visibleData.length).toFixed(1)}%
              </div>
            </div>
            <div>
              <span className="text-gray-400">Time Range:</span>
              <div className="font-medium">
                {timeRange === 'last30min' ? '30 minutes' : 'Full session'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}