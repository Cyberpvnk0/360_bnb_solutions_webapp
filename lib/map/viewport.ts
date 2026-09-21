/** Camera framing and viewport checks without importing the map renderer. */
export interface MapFocus {
  key: string;
  lat: number;
  lon: number;
  radiusMiles: number;
  bounds?: [number, number, number, number];
}

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Longitude can wrap across the antimeridian. Edges are inclusive. */
export function inBounds(p: { lat: number; lon: number }, b: MapBounds): boolean {
  const latOk = p.lat >= b.south && p.lat <= b.north;
  const lonOk =
    b.west <= b.east
      ? p.lon >= b.west && p.lon <= b.east
      : p.lon >= b.west || p.lon <= b.east;
  return latOk && lonOk;
}
