import type { MapCoordinate } from "@planme/core";
import type { RouteProviderStop } from "./types";

/** Formats provider duration seconds as the shared compact Korean label. */
export function formatRouteDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (minutes === 0) {
    return "0분";
  }

  if (hours <= 0) {
    return `약 ${remainingMinutes}분`;
  }

  return remainingMinutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${remainingMinutes}분`;
}

/** Appends a provider coordinate while dropping only an adjacent duplicate. */
export function appendCoordinate(path: MapCoordinate[], coordinate: MapCoordinate) {
  const previous = path[path.length - 1];

  // Provider chunks commonly repeat the boundary point between adjacent sections.
  if (previous && previous.lat === coordinate.lat && previous.lng === coordinate.lng) {
    return;
  }

  path.push(coordinate);
}

/** Removes only consecutive stops that resolve to the same physical location. */
export function removeAdjacentDuplicateProviderStops(stops: RouteProviderStop[]) {
  return stops.reduce<RouteProviderStop[]>((normalized, stop) => {
    const previous = normalized[normalized.length - 1];

    if (previous && isSameProviderStop(previous, stop)) {
      // Keep the later role/caption metadata while removing the zero-distance provider leg.
      normalized[normalized.length - 1] = stop;
      return normalized;
    }

    normalized.push(stop);
    return normalized;
  }, []);
}

/** Compares provider stops by stable identity before falling back to coordinates and labels. */
function isSameProviderStop(left: RouteProviderStop, right: RouteProviderStop) {
  if (left.placeSourceRef && right.placeSourceRef) {
    return left.placeSourceRef === right.placeSourceRef;
  }

  if (left.placeId && right.placeId) {
    return left.placeId === right.placeId;
  }

  if (left.coordinate && right.coordinate) {
    return (
      left.coordinate.lat === right.coordinate.lat &&
      left.coordinate.lng === right.coordinate.lng
    );
  }

  return left.label.trim() === right.label.trim();
}
