'use client';

import { Camera, Plus, Trash2, X } from 'lucide-react';
import { useRef } from 'react';
import { useFriendsConfig } from './FriendsConfigContext';
import { FlightLegCard } from './FlightLegCard';
import { AirportAutocomplete } from './AirportAutocomplete';
import { createDraftLeg } from '~/lib/utils/friendsConfigUtils';
import { resizeImageToDataUrl } from '~/lib/utils/imageUtils';
import { getFriendInitials } from '~/lib/utils/friendInitials';
import { getAirportFieldKey } from '~/lib/utils/airportUtils';
import { buildAirportChain, resolveAutoFriendAccentColor, resolveFriendAccentColor, type FriendTravelConfig } from '~/lib/friendsTracker';
import { colorToHex } from '../flight/colors';

interface FriendCardProps {
  friend: FriendTravelConfig;
  friendIndex: number;
}

export function FriendCard({ friend, friendIndex }: FriendCardProps) {
  const { selectedTrip, updateFriend, updateSelectedTripFriends, activeAirportField } = useFriendsConfig();
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const friendLabel = friend.name || `Friend ${friendIndex + 1}`;
  const hasOpenAirportSuggestions = activeAirportField?.startsWith(`${friend.id}:`) ?? false;
  const accentColor = colorToHex(resolveFriendAccentColor(friend, friendIndex));
  const autoAccentColor = colorToHex(resolveAutoFriendAccentColor(friend, friendIndex));
  const hasCustomAccentColor = typeof friend.colorOverride === 'string' && friend.colorOverride.trim().length > 0;
  const currentAirportFieldKey = getAirportFieldKey(friend.id, friend.id, 'current');

  const previewLegs = friend.flights.filter((leg) => {
    const values = [leg.flightNumber, leg.departureTime, leg.arrivalTime, leg.from, leg.to];
    return values.some((value) => typeof value === 'string' && value.trim().length > 0);
  });
  const destinationCodes = (selectedTrip?.destinationAirport ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const destinationArrivalIndex = destinationCodes.length > 0
    ? previewLegs.findIndex((leg) => {
      const arrivalCode = leg.to?.trim().toUpperCase() ?? '';
      return arrivalCode.length > 0 && destinationCodes.includes(arrivalCode);
    })
    : -1;
  const outboundLegs = destinationArrivalIndex >= 0 ? previewLegs.slice(0, destinationArrivalIndex + 1) : previewLegs;
  const returnLegs = destinationArrivalIndex >= 0 ? previewLegs.slice(destinationArrivalIndex + 1) : [];
  const itineraryPreview = [
    {
      label: destinationCodes.length > 0 ? 'To destination' : 'Route',
      route: buildAirportChain(outboundLegs).join(' → '),
    },
    {
      label: 'Return',
      route: buildAirportChain(returnLegs).join(' → '),
    },
  ].filter((segment) => segment.route.length > 0);

  return (
    <section className={`relative rounded-3xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-sm ${hasOpenAirportSuggestions ? 'z-40' : ''}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <div className="relative">
              <div
                className="relative h-16 w-16 cursor-pointer overflow-hidden rounded-full border-2 border-white/20 bg-slate-800 transition hover:border-cyan-400/60"
                title="Click to upload avatar photo"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = async (event) => {
                    const file = (event.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    try {
                      const dataUrl = await resizeImageToDataUrl(file);
                      updateFriend(friend.id, (currentFriend) => ({
                        ...currentFriend,
                        avatarUrl: dataUrl,
                      }));
                    } catch {
                      /* ignore */
                    }
                  };
                  input.click();
                }}
              >
                {friend.avatarUrl ? (
                  <img
                    src={friend.avatarUrl}
                    alt={friendLabel}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white/60">
                    {getFriendInitials(friendLabel)}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>
              {friend.avatarUrl ? (
                <button
                  type="button"
                  title="Remove avatar"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-rose-500/80 text-white transition hover:bg-rose-500"
                  onClick={() => {
                    updateFriend(friend.id, (currentFriend) => ({
                      ...currentFriend,
                      avatarUrl: null,
                    }));
                  }}
                >
                  <span className="text-[10px] font-bold leading-none">×</span>
                </button>
              ) : null}
            </div>

            <div className="mt-2 flex items-center justify-center gap-1.5">
              <input
                ref={colorInputRef}
                type="color"
                aria-label={`Accent color for ${friendLabel}`}
                value={accentColor}
                onChange={(event) => {
                  const color = event.target.value;
                  updateFriend(friend.id, (currentFriend) => ({
                    ...currentFriend,
                    colorOverride: color.toLowerCase() === autoAccentColor.toLowerCase() ? null : color,
                  }));
                }}
                className="sr-only"
              />
              <button
                type="button"
                aria-label={`Choose accent color for ${friendLabel}`}
                title={hasCustomAccentColor ? 'Change accent color' : 'Pick accent color'}
                onClick={() => {
                  const input = colorInputRef.current;
                  if (!input) {
                    return;
                  }

                  if (typeof input.showPicker === 'function') {
                    input.showPicker();
                    return;
                  }

                  input.click();
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-slate-950/80 transition hover:scale-105 hover:border-cyan-400/60"
              >
                <span className="h-3 w-3 rounded-full border border-white/60" style={{ backgroundColor: accentColor }} />
              </button>
              {hasCustomAccentColor ? (
                <button
                  type="button"
                  aria-label={`Use automatic accent color for ${friendLabel}`}
                  title="Use automatic accent color"
                  onClick={() => {
                    updateFriend(friend.id, (currentFriend) => ({
                      ...currentFriend,
                      colorOverride: null,
                    }));
                  }}
                  className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white/15 bg-slate-900/80 text-slate-200 transition hover:border-cyan-400/40 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                Friend name
              </label>
              <input
                value={friend.name}
                onChange={(event) => {
                  const name = event.target.value;
                  updateFriend(friend.id, (currentFriend) => ({
                    ...currentFriend,
                    name,
                  }));
                }}
                placeholder={`Friend ${friendIndex + 1}`}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20"
              />
              <p className="mt-1.5 text-xs text-slate-500">Click the avatar to upload a photo. Use the dot below it to pick or reset the map accent color.</p>
            </div>

            {friend.flights.length === 0 ? (
              <div className="max-w-xs">
                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                  Current airport
                </label>
                <AirportAutocomplete
                  fieldKey={currentAirportFieldKey}
                  value={friend.currentAirport ?? ''}
                  placeholder="JFK"
                  aria-label={`Current airport for ${friendLabel}`}
                  listboxLabel={`Current airport suggestions for ${friendLabel}`}
                  legId={friend.id}
                  onChange={(currentAirport) => {
                    updateFriend(friend.id, (currentFriend) => ({
                      ...currentFriend,
                      currentAirport,
                    }));
                  }}
                  onSelectAirport={(code) => {
                    updateFriend(friend.id, (currentFriend) => ({
                      ...currentFriend,
                      currentAirport: code,
                    }));
                  }}
                />
                <p className="mt-1.5 text-xs text-slate-500">Optional: pin a non-traveler to an airport on `/chantal` even if they have no flights.</p>
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => updateSelectedTripFriends((currentFriends) => currentFriends.filter((currentFriend) => currentFriend.id !== friend.id))}
          className="inline-flex items-center gap-2 self-start rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20"
        >
          <Trash2 className="h-4 w-4" />
          Remove friend
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {itineraryPreview.length > 0 ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Itinerary preview</p>
              <div className="flex flex-wrap gap-2">
                {itineraryPreview.map((segment) => (
                  <span
                    key={`${friend.id}-preview-${segment.label}`}
                    className="rounded-full border border-white/15 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-100"
                  >
                    <span className="font-semibold text-cyan-100">{segment.label}:</span> {segment.route}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {friend.flights.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/35 px-3 py-3 text-sm text-slate-400">
            No flights for this friend yet. Set a current airport to keep them on `/chantal`, or add an optional leg below.
          </div>
        ) : null}

        {friend.flights.map((leg, legIndex) => (
          <FlightLegCard
            key={leg.id}
            friendId={friend.id}
            leg={leg}
            legIndex={legIndex}
            totalLegs={friend.flights.length}
          />
        ))}

        <button
          type="button"
          onClick={() => {
            updateFriend(friend.id, (currentFriend) => ({
              ...currentFriend,
              flights: [...currentFriend.flights, createDraftLeg()],
            }));
          }}
          className="inline-flex items-center gap-2 rounded-full border border-dashed border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-500/20"
        >
          <Plus className="h-4 w-4" />
          Add flight / connection
        </button>
      </div>
    </section>
  );
}
