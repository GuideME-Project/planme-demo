import {
  isCarrymeDeliveryEvent,
  normalizeFinalDayTimelineEvents,
  normalizeStandardTimelineEvents,
  type RouteStop,
  type TimelineEvent,
} from "@planme/core";

type TimelineDisplayOptions = {
  isFinalDay: boolean;
  stops: RouteStop[];
};

/**
 * Creates the Standard timeline shown by the web detail page without mutating stored data.
 */
export function createStandardTimelineForWeb(
  events: TimelineEvent[],
  options?: TimelineDisplayOptions,
) {
  const normalizedEvents = normalizeStandardTimelineEvents(events);

  return options?.isFinalDay
    ? normalizeFinalDayTimelineEvents(normalizedEvents, options.stops)
    : normalizedEvents;
}

/**
 * Creates the CarryME timeline shown by the web detail page with final-day cleanup.
 */
export function createCarrymeTimelineForWeb(
  events: TimelineEvent[],
  options?: TimelineDisplayOptions,
) {
  return options?.isFinalDay
    ? normalizeFinalDayTimelineEvents(events, options.stops)
    : events;
}

/**
 * Detects the CarryME parcel event used for the web-only delivery icon treatment.
 */
export function isCarrymeDeliveryEventForWeb(event: TimelineEvent) {
  return isCarrymeDeliveryEvent(event);
}
