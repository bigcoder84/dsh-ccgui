/**
 * The picker's line icons the host's icon set does not have: the fast-mode bolt, filled when on
 * and outlined when off, the reset arrow, the search glass and the row chevrons.
 * @module dsh-ccgui/client/picker/picker-icons
 */

import type { ReactElement, ReactNode } from 'react'

interface IconProps {
  readonly size?: number
  readonly className?: string
}

function Line({ size = 16, className, children }: IconProps & { readonly children: ReactNode }): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** The fast-mode bolt; `on` fills it. */
export function BoltIcon({ size = 16, className, on }: IconProps & { readonly on: boolean }): ReactElement {
  if (!on) {
    return (
      <Line size={size} className={className}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
      </Line>
    )
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8Z" />
    </svg>
  )
}

export function ResetIcon(props: IconProps): ReactElement {
  return (
    <Line {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </Line>
  )
}

export function SearchIcon(props: IconProps): ReactElement {
  return (
    <Line {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Line>
  )
}

export function ChevronIcon({
  direction,
  ...props
}: IconProps & { readonly direction: 'down' | 'right' }): ReactElement {
  return <Line {...props}>{direction === 'down' ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />}</Line>
}

export function CheckIcon(props: IconProps): ReactElement {
  return (
    <Line {...props}>
      <path d="m5 12 5 5 9-10" />
    </Line>
  )
}
