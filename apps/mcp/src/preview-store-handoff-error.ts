export type PreviewStoreRepairContext = {
  dayIndex: number;
  placeConstraint: "fixed" | "replaceable";
  reason:
    | "destination_station_missing"
    | "origin_station_missing"
    | "walk_limit_exceeded"
    | "walk_path_missing";
  routeId: "carryme" | "standard";
  segmentIndex: number;
  stopRef: string;
};

export type PreviewStoreFailureStage =
  | "itinerary_finalization"
  | "place_resolution"
  | "route_calculation"
  | "storage";

/** Represents a redacted MCP-to-web handoff failure with optional repair metadata. */
export class PreviewStoreHandoffError extends Error {
  readonly internalCode: string;
  readonly repairCode?:
    | "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
    | "USER_PLACE_CONFIRMATION_REQUIRED";
  readonly repairContext?: PreviewStoreRepairContext;
  readonly failureStage?: PreviewStoreFailureStage;
  readonly retryable?: boolean;
  readonly status?: number;
  readonly traceId: string;

  constructor(
    traceId: string,
    internalCode: string,
    status?: number,
    repair?: {
      code?: PreviewStoreHandoffError["repairCode"];
      context?: PreviewStoreRepairContext;
    },
    classification?: {
      failureStage?: PreviewStoreFailureStage;
      retryable?: boolean;
    },
  ) {
    super(
      status === undefined
        ? "PlanME preview store handoff request failed"
        : `PlanME preview store handoff failed with status ${status}`,
    );
    this.name = "PreviewStoreHandoffError";
    this.internalCode = internalCode;
    this.repairCode = repair?.code;
    this.repairContext = repair?.context;
    this.failureStage = classification?.failureStage;
    this.retryable = classification?.retryable;
    this.status = status;
    this.traceId = traceId;
  }
}
