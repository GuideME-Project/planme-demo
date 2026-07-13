export type PreviewStoreRepairContext = {
  dayIndex: number;
  placeConstraint: "fixed" | "replaceable";
  reason:
    | "destination_station_missing"
    | "walk_limit_exceeded"
    | "walk_path_missing";
  routeId: "carryme" | "standard";
  segmentIndex: number;
  stopRef: string;
};

/** Represents a redacted MCP-to-web handoff failure with optional repair metadata. */
export class PreviewStoreHandoffError extends Error {
  readonly internalCode: string;
  readonly repairCode?:
    | "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
    | "USER_PLACE_CONFIRMATION_REQUIRED";
  readonly repairContext?: PreviewStoreRepairContext;
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
    this.status = status;
    this.traceId = traceId;
  }
}
