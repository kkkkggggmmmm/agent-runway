interface IconProps {
  size?: number;
}

export const RefreshIcon = ({ size = 18 }: IconProps) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.1 9A7 7 0 0 1 18.4 6.4L20 8M4 16l1.6 1.6A7 7 0 0 0 17.9 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const ClockIcon = ({ size = 20 }: IconProps) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 7.5V12l3.2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ShieldIcon = ({ size = 20 }: IconProps) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 3.2 19 6v5.2c0 4.2-2.6 7.8-7 9.6-4.4-1.8-7-5.4-7-9.6V6l7-2.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="m8.7 12 2.1 2.1 4.6-4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const GaugeIcon = ({ size = 20 }: IconProps) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="m12 13 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="13" r="1.4" fill="currentColor" />
  </svg>
);
