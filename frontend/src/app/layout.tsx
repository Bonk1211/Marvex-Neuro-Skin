import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NeuroSkin — Climate Decision Brain',
  description:
    'Synthetic tropical-day proof of an explainable adaptive facade controller.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='en'>
      <body className='min-h-screen bg-background font-sans text-foreground antialiased'>
        {children}
      </body>
    </html>
  )
}
