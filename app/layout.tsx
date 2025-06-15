// app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ECG Arrhythmia Monitor',
  description: 'Real-time ECG monitoring and PVC detection',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-white min-h-screen`}>
        <div className="flex flex-col min-h-screen">
          {/* Header */}
          <header className="bg-gray-900 border-b border-gray-700 p-4">
            <div className="container mx-auto">
              <h1 className="text-2xl font-bold text-center">
                <span className="text-green-400">🫀</span> ECG Arrhythmia Monitor
              </h1>
            </div>
          </header>
          
          {/* Main Content */}
          <main className="flex-1 container mx-auto p-4">
            {children}
          </main>
          
          {/* Footer */}
          <footer className="bg-gray-900 border-t border-gray-700 p-4 text-center text-gray-400">
            <p>ECG Monitor • Real-time PVC Detection</p>
          </footer>
        </div>
      </body>
    </html>
  )
}
