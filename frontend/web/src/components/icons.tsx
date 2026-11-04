// Small line icons drawn in the current text colour. Unlike the +, ✓ and × characters, they sit at
// the exact centre of round buttons, whatever the font.

const base = {
  width: 12,
  height: 12,
  viewBox: '0 0 12 12',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const PlusIcon = ({ size = 12 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M6 1.5v9M1.5 6h9" />
  </svg>
)

export const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M1.8 6.3 4.6 9 10.2 3" />
  </svg>
)

export const CloseIcon = ({ size = 12 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
)
