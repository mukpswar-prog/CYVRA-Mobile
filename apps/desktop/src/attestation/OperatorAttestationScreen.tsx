import { useState, useMemo } from "react";
import "./OperatorAttestationScreen.css";

export interface AttestationSlotItem {
  slotNumber: number;
  label: string; // e.g. "CYVRA.01"
  serial: string | null;
  make: string | null;
  model: string | null;
  checklistComplete: boolean;
  checklistAnswered: number;
  checklistExpected: number;
  checklistRecordedAt?: string | null;
}

export interface ChecklistCheck {
  id: string;
  title: string;
  category?: string;
  description?: string;
}

export interface OperatorAttestationScreenProps {
  slots: AttestationSlotItem[];
  selectedSlotIndex: number;
  onSelectSlot: (index: number) => void;
  activeOperatorId: string;
  onOpenOperatorModal: () => void;
  onRecordAttestation: (serial: string, answers: Record<string, string>) => Promise<void>;
  checklistCatalogue: ChecklistCheck[];
  checklistOutcomes: string[];
  slotAnswers: Record<string, Record<string, string>>; // slotLabel -> { checkId: outcome }
  onUpdateAnswer: (slotLabel: string, checkId: string, outcome: string) => void;
  busy: boolean;
  error: string | null;
}

const DEFAULT_CHECKS: ChecklistCheck[] = [
  { id: "PHY-001", category: "Physical Casing", title: "Enclosure and Chassis Integrity", description: "Enclosure free of cracks, structural bends, punctures, or unauthorized opening." },
  { id: "PHY-002", category: "Display & Glass", title: "Screen Surface and Touch Assembly", description: "Front glass free of spider cracks, delamination, deep scoring, or lifting." },
  { id: "PHY-003", category: "Battery Safety", title: "Battery Enclosure and Swelling Check", description: "No swelling, bulging, heat discoloration, sweet odor, or frame separation." },
  { id: "PHY-004", category: "Port & Connector", title: "USB Connector & Charging Pins", description: "USB port pins intact, free of debris, corrosion, burn marks, or mechanical looseness." },
  { id: "PHY-005", category: "Camera & Optics", title: "Lens Integrity & Optical Covers", description: "Front and rear camera glass free of cracks, clouding, condensation, or obstruction." },
  { id: "PHY-006", category: "Tamper Evidence", title: "Hardware Tamper-Evident Seals", description: "Factory warranty stickers, screws, and internal liquid ingress indicators (LDI) uncompromised." },
];

const DEFAULT_OUTCOMES = ["PASSED", "FAILED", "NOT_PERFORMED", "UNRESOLVED"];

export function OperatorAttestationScreen({
  slots,
  selectedSlotIndex,
  onSelectSlot,
  activeOperatorId,
  onOpenOperatorModal,
  onRecordAttestation,
  checklistCatalogue,
  checklistOutcomes,
  slotAnswers,
  onUpdateAnswer,
  busy,
  error,
}: OperatorAttestationScreenProps) {
  const [filter, setFilter] = useState<"all" | "assigned" | "unassigned">("all");

  const effectiveChecks = useMemo(() => {
    return checklistCatalogue && checklistCatalogue.length > 0 ? checklistCatalogue : DEFAULT_CHECKS;
  }, [checklistCatalogue]);

  const effectiveOutcomes = useMemo(() => {
    return checklistOutcomes && checklistOutcomes.length > 0 ? checklistOutcomes : DEFAULT_OUTCOMES;
  }, [checklistOutcomes]);

  const currentSlot = slots[selectedSlotIndex] ?? slots[0];
  const slotLabel = currentSlot?.label ?? "CYVRA.01";
  const currentAnswers = slotAnswers[slotLabel] ?? {};

  const filteredSlots = useMemo(() => {
    if (filter === "assigned") return slots.filter((s) => s.serial !== null);
    if (filter === "unassigned") return slots.filter((s) => s.serial === null);
    return slots;
  }, [slots, filter]);

  const assignedCount = useMemo(() => slots.filter((s) => s.serial !== null).length, [slots]);
  const completedCount = useMemo(() => slots.filter((s) => s.serial !== null && s.checklistComplete).length, [slots]);

  const allAnswered = useMemo(() => {
    if (!currentSlot || !currentSlot.serial) return false;
    return effectiveChecks.length > 0 && effectiveChecks.every((check) => Boolean(currentAnswers[check.id]));
  }, [currentSlot, effectiveChecks, currentAnswers]);

  const answeredCount = useMemo(() => {
    return effectiveChecks.filter((c) => Boolean(currentAnswers[c.id])).length;
  }, [effectiveChecks, currentAnswers]);

  const handleSelectOutcome = (checkId: string, outcome: string) => {
    if (!currentSlot || !currentSlot.serial) return;
    onUpdateAnswer(slotLabel, checkId, outcome);
  };

  const handleRecord = async () => {
    if (!currentSlot || !currentSlot.serial || !allAnswered || busy) return;
    await onRecordAttestation(currentSlot.serial, currentAnswers);
  };

  return (
    <div className="workspace attestation-screen">
      <div className="attestation-head">
        <div>
          <h1 className="page-title">Operator Physical Attestation</h1>
          <p className="workflow-note">
            Identity-bound physical hardware inspection for bench slots CYVRA.01 through CYVRA.50.
            Human physical observations remain distinct from software-collected evidence.
          </p>
        </div>

        <div className="operator-identity-badge">
          <span className="card-label">Active Technician</span>
          <div className="operator-identity-row">
            <strong className={activeOperatorId ? "operator-name" : "operator-missing"}>
              {activeOperatorId ? activeOperatorId : "Unspecified Operator"}
            </strong>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={onOpenOperatorModal}
              title="Change or set the technician identity authoring this attestation"
            >
              {activeOperatorId ? "Switch" : "Set Operator"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="band band-bridge" role="alert">
          <strong>ATTESTATION NOTICE</strong>
          <span>{error}</span>
        </div>
      )}

      {/* ---- 50-Slot Overview & Selector Bar ---- */}
      <section className="attestation-slots-overview" aria-label="50-Slot Bench Overview">
        <div className="slots-filter-row">
          <div className="slots-summary-stats">
            <span><strong>{assignedCount}</strong> of 50 slots connected</span>
            <span className="divider">•</span>
            <span><strong>{completedCount}</strong> verified</span>
          </div>

          <div className="filter-pill-group" role="radiogroup" aria-label="Filter Slots">
            <button
              type="button"
              className={`filter-pill${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All (50)
            </button>
            <button
              type="button"
              className={`filter-pill${filter === "assigned" ? " is-active" : ""}`}
              onClick={() => setFilter("assigned")}
            >
              Connected ({assignedCount})
            </button>
            <button
              type="button"
              className={`filter-pill${filter === "unassigned" ? " is-active" : ""}`}
              onClick={() => setFilter("unassigned")}
            >
              Unassigned ({50 - assignedCount})
            </button>
          </div>
        </div>

        <div className="slots-chips-grid">
          {filteredSlots.map((slot) => {
            const isSelected = slot.slotNumber === currentSlot?.slotNumber;
            const isAssigned = slot.serial !== null;
            const isComplete = slot.checklistComplete;
            const statusClass = !isAssigned
              ? "is-unassigned"
              : isComplete
                ? "is-completed"
                : "is-pending";

            return (
              <button
                key={slot.label}
                type="button"
                className={`slot-chip ${statusClass}${isSelected ? " is-selected" : ""}`}
                onClick={() => onSelectSlot(slot.slotNumber - 1)}
                title={
                  isAssigned
                    ? `${slot.label}: ${slot.serial} (${isComplete ? "Attestation Complete" : "Attestation Pending"})`
                    : `${slot.label}: Unassigned (No device connected)`
                }
                aria-pressed={isSelected}
              >
                <span className="slot-chip-label">{slot.label}</span>
                <span className="slot-chip-status">
                  {!isAssigned ? "—" : isComplete ? "✓" : "●"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Active Slot Attestation Form ---- */}
      <section className="attestation-panel" aria-labelledby="active-slot-heading">
        <div className="attestation-panel-header">
          <div>
            <span className="card-label">Selected Bench Slot</span>
            <h2 id="active-slot-heading" className="active-slot-title">
              {currentSlot.label}
              {currentSlot.serial ? (
                <span className="badge badge-success">Hardware Bound</span>
              ) : (
                <span className="badge badge-muted">Unassigned</span>
              )}
            </h2>
          </div>

          <div className="slot-meta-strip">
            <div className="meta-item">
              <span className="meta-label">Physical Serial:</span>
              <strong className="meta-value path">
                {currentSlot.serial ?? "None (No physical device established)"}
              </strong>
            </div>
            {currentSlot.model && (
              <div className="meta-item">
                <span className="meta-label">Model:</span>
                <strong className="meta-value">{currentSlot.make ? `${currentSlot.make} ` : ""}{currentSlot.model}</strong>
              </div>
            )}
            <div className="meta-item">
              <span className="meta-label">Checklist Progress:</span>
              <strong className="meta-value">
                {currentSlot.serial
                  ? `${answeredCount} of ${effectiveChecks.length} Answered`
                  : "N/A (Slot Unassigned)"}
              </strong>
            </div>
          </div>
        </div>

        {!currentSlot.serial ? (
          <div className="attestation-unassigned-notice">
            <div className="notice-icon" aria-hidden="true">🔒</div>
            <div className="notice-body">
              <h3>No Physical Device Established</h3>
              <p>
                Slot <strong>{currentSlot.label}</strong> has no physical device bound to it over USB/ADB.
                Connect an authorized test device to establish physical hardware identity before recording operator attestation.
              </p>
              <p className="subtle">
                Physical observations cannot be manufactured for an empty slot.
              </p>
            </div>
          </div>
        ) : (
          <div className="attestation-content">
            {currentSlot.checklistComplete && (
              <div className="notice-banner is-success">
                <span className="banner-glyph" aria-hidden="true">✓</span>
                <div>
                  <strong>Attestation Verified for {currentSlot.label} ({currentSlot.serial})</strong>
                  <p>
                    Physical checklist completed and stamped by technician. All human observations are sealed with the device session.
                  </p>
                </div>
              </div>
            )}

            <div className="checks-table-container">
              <table className="checks-table">
                <thead>
                  <tr>
                    <th className="col-check-id">ID</th>
                    <th className="col-check-info">Physical Observation &amp; Scope</th>
                    <th className="col-check-actions">Attestation Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveChecks.map((check) => {
                    const selectedOutcome = currentAnswers[check.id];

                    return (
                      <tr key={check.id} className={selectedOutcome ? "is-answered" : "is-unanswered"}>
                        <td className="col-check-id">
                          <span className="check-id-badge">{check.id}</span>
                        </td>
                        <td className="col-check-info">
                          <span className="check-category">{check.category ?? "Hardware Integrity"}</span>
                          <strong className="check-title">{check.title}</strong>
                          {check.description && <p className="check-desc">{check.description}</p>}
                        </td>
                        <td className="col-check-actions">
                          <div className="outcome-btn-group" role="radiogroup" aria-label={`Outcome for ${check.id}`}>
                            {effectiveOutcomes.map((outcome) => {
                              const isChecked = selectedOutcome === outcome;
                              const toneSlug =
                                outcome === "PASSED"
                                  ? "pass"
                                  : outcome === "FAILED"
                                    ? "fail"
                                    : "neutral";

                              return (
                                <button
                                  key={outcome}
                                  type="button"
                                  className={`outcome-btn is-${toneSlug}${isChecked ? " is-active" : ""}`}
                                  onClick={() => handleSelectOutcome(check.id, outcome)}
                                  aria-pressed={isChecked}
                                  title={`Mark ${check.id} as ${outcome}`}
                                >
                                  {outcome === "PASSED" ? "PASS" : outcome === "FAILED" ? "FAIL" : outcome === "NOT_PERFORMED" ? "N/P" : "UNRES"}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="attestation-submit-bar">
              <div className="submit-info">
                {!activeOperatorId && (
                  <span className="warning-text">⚠️ No Operator ID assigned. Setting your technician identity is required before certification.</span>
                )}
                {activeOperatorId && !allAnswered && (
                  <span>Please answer all {effectiveChecks.length} checks ({effectiveChecks.length - answeredCount} remaining).</span>
                )}
                {activeOperatorId && allAnswered && (
                  <span className="success-text">✓ All checks answered. Ready to stamp attestation.</span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                disabled={!allAnswered || busy}
                onClick={handleRecord}
                aria-label={busy ? "Recording..." : `Record Attestation for ${currentSlot.label}`}
              >
                {busy ? "Recording..." : `Record Attestation (${currentSlot.label})`}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
