import {
  isCarrymeDeliveryEvent,
  normalizeStandardTimelineEvents,
  type TimelineEvent,
} from "@planme/core";

/**
 * Creates the Standard timeline shown by the web detail page without mutating stored data.
 */
export function createStandardTimelineForWeb(events: TimelineEvent[]) {
  return normalizeStandardTimelineEvents(events);
}

/**
 * Detects the CarryME parcel event used for the web-only delivery icon treatment.
 */
export function isCarrymeDeliveryEventForWeb(event: TimelineEvent) {
  return isCarrymeDeliveryEvent(event);
}
