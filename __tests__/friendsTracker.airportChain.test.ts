import { describe, expect, it } from 'vitest';
import { buildAirportChain } from '~/lib/friendsTracker';

describe('buildAirportChain', () => {
  it('builds a chain from a single leg', () => {
    const legs = [{ id: 'l1', flightNumber: 'AF1', departureTime: '', from: 'CDG', to: 'JFK' }];
    expect(buildAirportChain(legs)).toEqual(['CDG', 'JFK']);
  });

  it('builds a chain from multiple connecting legs', () => {
    const legs = [
      { id: 'l1', flightNumber: 'AF1', departureTime: '', from: 'CDG', to: 'AMS' },
      { id: 'l2', flightNumber: 'KL2', departureTime: '', from: 'AMS', to: 'JFK' },
      { id: 'l3', flightNumber: 'AA3', departureTime: '', from: 'JFK', to: 'MIA' },
    ];
    expect(buildAirportChain(legs)).toEqual(['CDG', 'AMS', 'JFK', 'MIA']);
  });

  it('skips null airports', () => {
    const legs = [
      { id: 'l1', flightNumber: 'AF1', departureTime: '', from: null, to: 'AMS' },
      { id: 'l2', flightNumber: 'KL2', departureTime: '', from: 'AMS', to: null },
    ];
    expect(buildAirportChain(legs)).toEqual(['AMS']);
  });

  it('returns empty array when all airports are null', () => {
    const legs = [
      { id: 'l1', flightNumber: 'AF1', departureTime: '', from: null, to: null },
    ];
    expect(buildAirportChain(legs)).toEqual([]);
  });

  it('avoids consecutive duplicates', () => {
    const legs = [
      { id: 'l1', flightNumber: 'AF1', departureTime: '', from: 'CDG', to: 'CDG' },
      { id: 'l2', flightNumber: 'AF2', departureTime: '', from: 'CDG', to: 'MIA' },
    ];
    expect(buildAirportChain(legs)).toEqual(['CDG', 'MIA']);
  });
});
