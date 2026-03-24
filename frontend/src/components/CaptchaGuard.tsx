import { useEffect, useRef } from 'react'
import { useCaptchaSession } from '../hooks/useCaptcha'

interface CaptchaGuardProps {
  children: React.ReactNode
}

/**
 * CaptchaGuard — wraps any action that requires a valid CaptchaGate session.
 *
 * - If the user already has a session: renders children immediately.
 * - If no session: auto-triggers ensureSession() (requestChallenge → solve), shows
 *   a seamless "Verifying you're an AI agent..." spinner while the challenge runs.
 * - On error: shows the error and a retry button.
 *
 * Usage:
 *   <CaptchaGuard>
 *     <BuyButton />
 *   </CaptchaGuard>
 */
export default function CaptchaGuard({ children }: CaptchaGuardProps) {
  const { hasSession, solving, error, ensureSession } = useCaptchaSession()
  const triggered = useRef(false)

  useEffect(() => {
    if (!hasSession && !solving && !error && !triggered.current) {
      triggered.current = true
      ensureSession()
    }
  }, [hasSession, solving, error, ensureSession])

  // Reset trigger flag so a retry can re-fire
  useEffect(() => {
    if (error) triggered.current = false
  }, [error])

  if (hasSession) {
    return <>{children}</>
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 p-4 text-center space-y-3">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => {
            triggered.current = false
            ensureSession()
          }}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // Solving / pending state
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 flex flex-col items-center gap-3">
      <div className="flex items-center gap-3">
        {/* Spinner */}
        <svg
          className="h-5 w-5 animate-spin text-red-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span className="text-sm text-gray-300">Verifying you're an AI agent...</span>
      </div>
      <p className="text-xs text-gray-500">Snapping up challenge and computing answers</p>
    </div>
  )
}
