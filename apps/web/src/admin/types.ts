/**
 * The admin console's view of the Phase 2 responses.
 *
 * Written against the routes as they are committed, not against what a table
 * would like them to be. Three shapes carry a deliberate asymmetry worth
 * stating once, because every render decision below follows from it:
 *
 *   `LicenceListItem` (from `GET /admin/serials`)
 *     - `publicNumber` does NOT exist. The server destructures it out.
 *     - `licenceKey` is masked, `publicNumberMasked` is the same mask again,
 *       `serialFp` is a fingerprint of the unmasked value.
 *
 *   `LicenceRecord` (from `GET /admin/serials/:id`)
 *     - `publicNumber` and `licenceKey` are the FULL key. This is the only
 *       place it exists, and it is a single-resource fetch precisely so that
 *       "every key at once" stays impossible.
 *
 * So the two are not the same interface with an optional field: they differ in
 * a way the type system should refuse to blur. `LicenceListItem extends
 * Omit<LicenceRecord, ...>` would let a row cell read `serial.publicNumber`
 * and compile. It cannot, and that is the point.
 */

export type StaffRole = "SUPER_ADMIN" | "LICENCE_ADMIN" | "OPERATOR" | "AUDITOR";

export type LicenceStatus =
  | "DRAFT"
  | "PAYMENT_PENDING"
  | "PAYMENT_CONFIRMED"
  | "READY_TO_GENERATE"
  | "KEY_GENERATED"
  | "ISSUED"
  | "ACTIVE"
  | "EXPIRED"
  | "SUSPENDED"
  | "REVOKED";

export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "PARTIALLY_PAID"
  | "REFUNDED"
  | "CANCELLED";

export type HostBindingStatus = "NOT_BOUND" | "BOUND" | "REBIND_REQUEST" | "LOCKED";

export type DeliveryStatus = "SENT" | "FAILED";

export type StaffStatus = "INVITED" | "EMAIL_VERIFIED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

/** Fields every list response carries, whether or not it found anything. */
export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
  returned: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  nextPage: number | null;
}

/** The projection shared by the list and the drawer, minus the key. */
interface SerialBody {
  serialId: string;
  status: LicenceStatus;
  customerKind: string;
  deviceMax: number;
  planCode: string;
  hostBindingStatus: HostBindingStatus;
  slabLabel: string;
  brandScope: string;
  customerEmail: string;
  customerFullName: string | null;
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  state: string | null;
  userId: string | null;
  paymentNoted: string;
  /**
   * `null` means "no payment record exists" - NOT "pending".
   *
   * These are different claims and only one of them is true, which is why the
   * console renders a distinct "No record" badge rather than folding `null`
   * into Pending. `POST /serials` creates the row as PENDING, so an absent row
   * means the record was created outside this API.
   */
  paymentStatus: PaymentStatus | null;
  firstActivatedAt: string | null;
  validityStartsAt: string | null;
  validityEndsAt: string | null;
  devicesBound: number;
  /**
   * Who created the row (`jsonSerial.createdBy`, design freeze §29).
   *
   * `null` on every row written before W5, where `issued_by` was the only
   * actor column and a successful issuance overwrote the creator with the
   * issuer. Shown in the drawer only: §13/§65 keep the table's column set
   * where it is, and §56 already carries it in the XLSX export.
   */
  createdBy: string | null;
  /**
   * `string | null` because `jsonSerial` withholds it until `issued_at`
   * exists: an unissued record has no issuer to name.
   */
  issuedBy: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  emailedAt: string | null;
  emailMessageId: string | null;
  emailError: string | null;
}

/** One row of the registry. Carries a MASKED key and no `publicNumber`. */
export interface LicenceListItem extends SerialBody {
  licenceKey: string | null;
  publicNumberMasked: string | null;
  serialFp: string | null;
}

/** The drawer's record. Carries the FULL key, and is the only place it exists. */
export interface LicenceRecord extends SerialBody {
  publicNumber: string | null;
  licenceKey: string | null;
}

export interface SerialListResponse {
  superAdmin: string;
  actor: string;
  serials: LicenceListItem[];
  filters: Record<string, unknown>;
  pagination: Pagination;
}

export interface SerialRecordResponse {
  superAdmin: string;
  actor: string;
  serial: LicenceRecord;
  serialFp: string | null;
}

export interface MeResponse {
  email: string;
  /** `null` only for a service principal, which has no person behind it. */
  role: StaffRole | null;
  superAdmin: boolean;
  superAdminEmail: string;
}

export interface StaffMember {
  staffId: string;
  email: string;
  status: StaffStatus;
  role: StaffRole;
  nominatedBy: string;
  nominatedAt: string | null;
  revokedAt: string | null;
}

export interface StaffListResponse {
  superAdmin: string;
  actor: string;
  operators: StaffMember[];
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  /** Joined from `staff_operators`; `null` when `actor_id` is NULL. */
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  ipAddress: string;
  reason: string | null;
  createdAt: string;
}

export interface AuditListResponse {
  superAdmin: string;
  /** `null` for a service principal, which has no person behind it. */
  actor: string | null;
  /** `self` for a LIMITED seat - the sentence the Audit page has to render. */
  scope: "all" | "self";
  scopeActorId: string | null;
  events: AuditEvent[];
  filters: Record<string, unknown>;
  pagination: Pagination;
}

export interface ReportRow {
  [column: string]: string | number | null;
}

/**
 * `GET /admin/reports/licences`.
 *
 * Note the absence of a `filters` echo: unlike `GET /serials`, this route takes
 * only `from` and `to` - there is no status, payment or plan filter on it. The
 * Reports page is built around that rather than around what a filter bar would
 * like to be true; narrowing a report here is a display convenience over the
 * rows the range produced, and the export always carries the full range.
 */
export interface ReportResponse {
  actor: string;
  from: string;
  to: string;
  count: number;
  rows: ReportRow[];
}
