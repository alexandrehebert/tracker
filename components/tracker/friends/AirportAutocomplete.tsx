'use client';

import { useFriendsConfig } from './FriendsConfigContext';
import { formatAirportSuggestionLabel, getAirportSuggestionCode, normalizeAirportCode } from '~/lib/utils/airportUtils';

interface AirportAutocompleteProps {
  fieldKey: string;
  value: string;
  placeholder: string;
  'aria-label': string;
  listboxLabel: string;
  legId: string;
  onChange: (value: string) => void;
  onSelectAirport: (code: string, timezone: string | null) => void;
}

export function AirportAutocomplete({
  fieldKey,
  value,
  placeholder,
  'aria-label': ariaLabel,
  listboxLabel,
  legId,
  onChange,
  onSelectAirport,
}: AirportAutocompleteProps) {
  const { activeAirportField, setActiveAirportField, airportSuggestions, setAirportSuggestions, airportTimezones } = useFriendsConfig();

  const suggestions = activeAirportField === fieldKey ? airportSuggestions : [];
  const showSuggestions = suggestions.length > 0;

  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showSuggestions}
        value={value}
        onFocus={() => {
          const selectedCode = normalizeAirportCode(value);
          setActiveAirportField(fieldKey);
          setAirportSuggestions((currentSuggestions) => selectedCode
            ? currentSuggestions.filter((airport) => getAirportSuggestionCode(airport) === selectedCode)
            : []);
        }}
        onBlur={() => setActiveAirportField((currentField) => currentField === fieldKey ? null : currentField)}
        onChange={(event) => {
          setActiveAirportField(fieldKey);
          onChange(event.target.value.toUpperCase());
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
      />
      {showSuggestions ? (
        <div
          role="listbox"
          aria-label={listboxLabel}
          className="absolute left-0 right-0 z-50 mt-1 max-h-44 w-full overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 p-1.5 shadow-lg shadow-slate-950/40"
        >
          {suggestions.map((airport) => {
            const suggestionCode = getAirportSuggestionCode(airport);
            const location = [airport.city, airport.country].filter(Boolean).join(', ');
            const isSelected = normalizeAirportCode(value) === suggestionCode;

            const handleSelect = () => {
              const timezone = airport.timezone?.trim() || airportTimezones[suggestionCode] || null;
              setActiveAirportField(null);
              setAirportSuggestions([]);
              onSelectAirport(suggestionCode, timezone);
            };

            return (
              <div
                key={`${legId}-${fieldKey}-${suggestionCode}`}
                role="option"
                tabIndex={0}
                aria-selected={isSelected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleSelect}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect();
                  }
                }}
                className={`mb-1 last:mb-0 flex cursor-pointer flex-col rounded-xl px-3 py-2 text-left text-sm transition focus:outline-none ${isSelected
                  ? 'bg-cyan-500/15 text-cyan-50 ring-1 ring-cyan-400/50'
                  : 'text-slate-100 hover:bg-slate-900 focus:bg-slate-900'}`}
              >
                <span>{formatAirportSuggestionLabel(airport)}</span>
                {location ? <span className="text-[11px] text-slate-400">{location}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
