import { Globe } from 'lucide-react';
import * as Flags from 'country-flag-icons/react/1x1';
import { hasFlag } from 'country-flag-icons';
import { resolveCountryCode } from '~/lib/utils/countryFlag';

interface CountryFlagProps {
  country: string;
  countryCode?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
};

export default function CountryFlag({ country, countryCode, size = 'sm', className }: CountryFlagProps) {
  const resolvedCountryCode = countryCode || resolveCountryCode(country);
  const FlagComponent =
    resolvedCountryCode && hasFlag(resolvedCountryCode)
      ? Flags[resolvedCountryCode as keyof typeof Flags]
      : null;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10 ${SIZE_CLASSES[size]}${className ? ` ${className}` : ''}`}
    >
      {FlagComponent ? (
        <FlagComponent
          title={country}
          className="h-full w-full"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-slate-700">
          <Globe className="h-[55%] w-[55%] text-slate-400" />
        </span>
      )}
    </span>
  );
}
