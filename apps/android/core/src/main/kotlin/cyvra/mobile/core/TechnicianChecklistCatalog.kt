package cyvra.mobile.core

/**
 * The ratified technician checklist: the 14 parameters that no software path can
 * establish - 13 that the engineering workbook marks `No / not safely replaceable`,
 * plus PHY-008, added by ruling CE-2 (Chief Engineer, 13-Oct-2026).
 *
 * Why these are a checklist and not collectors
 * -------------------------------------------
 * Every item below is one the workbook records as `CYVRA Capability = No`, needing
 * `Physical required`, `Assisted physical` or `Physical/service required` evidence.
 * No ADB command, no Windows plane and no camera pass can establish any of them, because
 * each is a physical or specialist condition of the device body, a connector, an acoustic
 * path, an antenna, a card tray or a NAND array.
 *
 * PHY-008 is the one row whose Automation Impact entry reads `Conditional / assisted`
 * rather than `No / not safely replaceable`. Both workbooks are reconciled inside its
 * own `whyNotAutomatable` text rather than being silently collapsed, because a reader
 * who opens the second workbook must find what this file claims it says.
 *
 * Presenting them as a checklist is what lets the 114-parameter plan be COMPLETE IN
 * PROCESS without pretending to be complete in AUTOMATION. The distinction is the whole
 * point: the product records that a qualified person performed the check and what they
 * found. It never converts that into a software observation.
 *
 * Text below is transcribed from the workbook rather than paraphrased, so that a reader
 * can put this file beside `CYVRA_Mobile_AI_Physical_Inspection_and_Certified_Grading_Engineering_Report.xlsx`
 * → `Automation Impact Matrix` and check every row.
 */
object TechnicianChecklistCatalog {

    /**
     * The workbook's own boundary sentence, verbatim. It applies to the 13 rows the
     * workbook marks `No / not safely replaceable`:
     * "AI may flag visible clues but cannot establish the complete physical or specialist
     * condition."
     *
     * PHY-008 deliberately does NOT use this sentence: its Automation Impact row carries a
     * different Reason / Boundary, quoted inside its own entry below.
     */
    private const val WORKBOOK_BOUNDARY =
        "Workbook boundary: AI may flag visible clues but cannot establish the complete " +
            "physical or specialist condition."

    val all: List<TechnicianCheckDefinition> = listOf(
        TechnicianCheckDefinition(
            id = "AUD-002",
            domain = "Audio",
            item = "Speaker distortion/weakness",
            priority = "P1",
            whyNotAutomatable =
                "Establishes an acoustic path under reference stimulus. A shell command can " +
                    "show that a device reports an audio route; it cannot drive the speaker at " +
                    "reference level, capture the output, or judge distortion. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "BAT-007",
            domain = "Battery",
            item = "Battery swelling",
            priority = "P1",
            whyNotAutomatable =
                "Swelling is a deformation of the cell body. It is established by sight, touch " +
                    "or a flatness jig. No sensor on a live handset reports cell geometry, and " +
                    "a swollen cell is a safety hazard, so an inferred answer is not acceptable. " +
                    WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "BAT-008",
            domain = "Battery",
            item = "Charging connector looseness",
            priority = "P1",
            whyNotAutomatable =
                "A retention-force tolerance. The device proving that it charges proves " +
                    "electrical contact at that moment, not the mechanical retention the " +
                    "connector is specified to hold. Requires physical insertion cycles, " +
                    "optionally against a gauge. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "BIO-002",
            domain = "Biometrics",
            item = "Fingerprint sensor surface condition",
            priority = "P1",
            whyNotAutomatable =
                "Surface wear, scratching or contamination on the sensor window. The sensor " +
                    "reporting successful enrolment says nothing about the condition of the " +
                    "surface that the next owner will touch. Requires direct inspection. " +
                    WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "CELL-005",
            domain = "Cellular",
            item = "RF/antenna performance",
            priority = "P1",
            whyNotAutomatable =
                "Radiated performance requires a calibrated antenna test fixture or a " +
                    "controlled field test. Handset software does not truthfully expose antenna " +
                    "gain or radiated power, and a modem registering on a network proves only " +
                    "that one link worked once. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-001",
            domain = "Mechanical",
            item = "Power button tactile function",
            priority = "P1",
            whyNotAutomatable =
                "The application CAN assist: it can prompt for the press and record whether the " +
                    "input event arrived. That observation is electrical, not tactile. A button " +
                    "that reports while feeling wrong - mushy, sticky, or with no detent - is " +
                    "still a defect, and only the technician judges the feel. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-002",
            domain = "Mechanical",
            item = "Volume buttons tactile function",
            priority = "P1",
            whyNotAutomatable =
                "As PHY-001: the application can prompt and record that the event arrived, " +
                    "which is an electrical observation. Force, travel and detent are mechanical " +
                    "properties only a technician or a force gauge establishes. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-003",
            domain = "Mechanical",
            item = "USB connector mechanical fit",
            priority = "P1",
            whyNotAutomatable =
                "Retention and insertion feel are mechanical tolerances. A data session over the " +
                    "same connector proves electrical contact only. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-004",
            domain = "Mechanical",
            item = "USB port debris/corrosion",
            priority = "P1",
            whyNotAutomatable =
                "Requires looking inside the port, normally with magnification and raking " +
                    "light. Corrosion may coexist with a working data session. " +
                    WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-008",
            domain = "Mechanical",
            item = "SIM tray/slot integrity",
            priority = "P1",
            whyNotAutomatable =
                "Workbook Capability Matrix records CYVRA Capability = `No`, Evidence Type = " +
                    "`Physical required`, Primary Source / Method = `Physical insertion/handling`, " +
                    "Typical Evidence / Output = `Fit/contact/retention`, Physical Check / Fixture = " +
                    "`Known-good SIM/tray`, and the Limitation / Caveat verbatim as `Software SIM " +
                    "state is insufficient`. A software SIM state says nothing about whether the " +
                    "tray seats, makes contact, or is retained. " +
                    "WHY THIS ROW IS HERE DESPITE A DIFFERENT WORKBOOK COLUMN: the Automation " +
                    "Impact Matrix records this row as `Conditional / assisted` with Recommended " +
                    "Product Action `Capability-aware collector + guided exception workflow`, " +
                    "which describes a human working the check WITH the application guiding them, " +
                    "not software answering it. Read that way the two workbooks agree, and the " +
                    "Capability Matrix - which is the capability statement - governs. Recorded as " +
                    "the 14th item by ruling CE-2 (Chief Engineer, 13-Oct-2026). " +
                    "Workbook boundary for this row: OEM/version/permission or physical boundary " +
                    "applies.",
        ),
        TechnicianCheckDefinition(
            id = "PHY-009",
            domain = "Mechanical",
            item = "microSD slot integrity where present",
            priority = "P1",
            whyNotAutomatable =
                "Slot latch condition and pin integrity are established by inspection and by " +
                    "inserting a card. Note the `where present`: on a device with no slot the " +
                    "correct answer is NOT_APPLICABLE, not PASS. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-014",
            domain = "Mechanical",
            item = "Water-resistance/IP seal integrity",
            priority = "P1",
            whyNotAutomatable =
                "Gasket and seal condition require a pressure-decay rig or manufacturer service " +
                    "tooling. Software cannot infer seal condition, and a device that has been " +
                    "opened no longer holds its original rating. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PHY-015",
            domain = "Mechanical",
            item = "Internal screws/fasteners condition",
            priority = "P1",
            whyNotAutomatable =
                "Requires disassembly. Strip-out, missing screws or non-original fasteners are " +
                    "visible only with the device open. " + WORKBOOK_BOUNDARY,
        ),
        TechnicianCheckDefinition(
            id = "PUR-007",
            domain = "Sanitization",
            item = "Physical NAND cell-level verification",
            priority = "P0",
            whyNotAutomatable =
                "The only P0 on this checklist. Cell-level verification requires specialist " +
                    "forensic hardware and controlled handling; the workbook records the evidence " +
                    "type as `Not reliably determinable`. No software method on a live handset " +
                    "establishes it, so any product claiming to is claiming something it cannot " +
                    "measure. " + WORKBOOK_BOUNDARY,
        ),
    )

    /** Workbook order is significant; it is the order a technician works the device. */
    val ids: List<String> = all.map { it.id }

    val expectedCount: Int get() = all.size

    fun definitionFor(id: String): TechnicianCheckDefinition? = all.firstOrNull { it.id == id }

    /** The single P0 item. Included so a UI can surface it above the P1 items. */
    val p0Items: List<TechnicianCheckDefinition> = all.filter { it.priority == "P0" }

    fun newRecord(sessionUuid: String, deviceIdentifier: String): TechnicianChecklistRecord =
        TechnicianChecklistRecord(
            checklistId = "TECH-" + sessionUuid,
            sessionUuid = sessionUuid,
            deviceIdentifier = deviceIdentifier,
            expectedCount = expectedCount,
            results = emptyList(),
            completedAt = null,
        )
}
