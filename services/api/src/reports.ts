import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  deviceLifecycles,
  evidenceRecords,
  processingSessions,
  reportManifests,
  reports,
} from "@cyvra/database/schema";
import {
  REPORT_1_NONGOALS,
  REPORT_1_TITLE,
  SCHEMA_VERSION,
  assembleManifest,
  asDeviceLifecycleId,
  asEvidenceId,
  asProcessingSessionId,
  coverageCaption,
  enrichEntry,
  formatReportNumber,
  isEvidenceResult,
  isEvidenceSource,
  isUuid,
  type EvidenceRecord,
} from "@cyvra/evidence";
import type { Database } from "./db";
import type { Env } from "./env";
import { requireUser } from "./user";

function iso(value: Date): string {
  return value.toISOString();
}

function toRecord(row: {
  id: string;
  deviceLifecycleId: string;
  processingSessionId: string;
  testId: string;
  source: string;
  result: string;
  collectedAt: Date;
  method: string;
  limitation: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
}): EvidenceRecord | null {
  if (!isEvidenceResult(row.result) || !isEvidenceSource(row.source)) {
    return null;
  }
  const record: EvidenceRecord = {
    schemaVersion: SCHEMA_VERSION,
    evidenceId: asEvidenceId(row.id),
    deviceLifecycleId: asDeviceLifecycleId(row.deviceLifecycleId),
    processingSessionId: asProcessingSessionId(row.processingSessionId),
    testId: row.testId,
    source: row.source,
    result: row.result,
    collectedAt: iso(row.collectedAt),
    method: row.method,
  };
  if (row.limitation) {
    record.limitation = row.limitation as EvidenceRecord["limitation"];
  }
  if (row.notes) record.notes = row.notes;
  if (row.payload) record.payload = row.payload;
  return record;
}

export const reportRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

reportRoutes.get("/sessions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const db = c.get("db");
  const rows = await db
    .select({
      processingSessionId: processingSessions.id,
      deviceLifecycleId: processingSessions.deviceLifecycleId,
      createdAt: processingSessions.createdAt,
      manufacturer: deviceLifecycles.manufacturer,
      model: deviceLifecycles.model,
    })
    .from(processingSessions)
    .innerJoin(
      deviceLifecycles,
      eq(processingSessions.deviceLifecycleId, deviceLifecycles.id),
    )
    .where(eq(processingSessions.userId, user.id))
    .orderBy(desc(processingSessions.createdAt));
  return c.json({
    sessions: rows.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt),
    })),
  });
});

reportRoutes.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const db = c.get("db");
  const rows = await db
    .select({
      reportId: reports.id,
      publicNumber: reports.publicNumber,
      processingSessionId: reports.processingSessionId,
      deviceLifecycleId: reports.deviceLifecycleId,
      coverage: reports.coverage,
      frozenAt: reports.frozenAt,
    })
    .from(reports)
    .where(eq(reports.userId, user.id))
    .orderBy(desc(reports.frozenAt));
  return c.json({
    title: REPORT_1_TITLE,
    reports: rows.map((row) => ({
      ...row,
      frozenAt: iso(row.frozenAt),
      coverageCaption: coverageCaption(row.coverage as "COMPLETE" | "LIMITED" | "PARTIAL"),
    })),
  });
});

reportRoutes.get("/:reportId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const reportId = c.req.param("reportId");
  if (!isUuid(reportId)) {
    return c.json({ error: "reportId must be a UUID." }, 400);
  }
  const db = c.get("db");
  const [row] = await db
    .select({
      reportId: reports.id,
      publicNumber: reports.publicNumber,
      userId: reports.userId,
      coverage: reports.coverage,
      frozenAt: reports.frozenAt,
      snapshot: reportManifests.snapshot,
    })
    .from(reports)
    .innerJoin(reportManifests, eq(reportManifests.reportId, reports.id))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row || row.userId !== user.id) {
    return c.json({ error: "Report not found." }, 404);
  }
  const snapshot = row.snapshot as {
    deviceLifecycleId?: string;
    processingSessionId?: string;
    entries?: Array<{
      testId: string;
      evidenceId: string;
      result: string;
      source: string;
    }>;
  };
  const entries = (snapshot.entries ?? []).flatMap((entry) => {
    if (!isEvidenceResult(entry.result) || !isEvidenceSource(entry.source)) {
      return [];
    }
    return [
      enrichEntry({
        testId: entry.testId,
        evidenceId: asEvidenceId(entry.evidenceId),
        result: entry.result,
        source: entry.source,
      }),
    ];
  });
  return c.json({
    title: REPORT_1_TITLE,
    reportId: row.reportId,
    publicNumber: row.publicNumber,
    coverage: row.coverage,
    coverageCaption: coverageCaption(row.coverage as "COMPLETE" | "LIMITED" | "PARTIAL"),
    frozenAt: iso(row.frozenAt),
    deviceLifecycleId: snapshot.deviceLifecycleId ?? null,
    processingSessionId: snapshot.processingSessionId ?? null,
    entries,
    nongoals: REPORT_1_NONGOALS,
    snapshot: row.snapshot,
  });
});

reportRoutes.post("/freeze", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    processingSessionId?: string;
  };
  const processingSessionId = (body.processingSessionId ?? "").trim();
  if (!isUuid(processingSessionId)) {
    return c.json({ error: "processingSessionId must be a UUID." }, 400);
  }

  const db = c.get("db");
  const [session] = await db
    .select()
    .from(processingSessions)
    .where(eq(processingSessions.id, processingSessionId))
    .limit(1);
  if (!session || session.userId !== user.id) {
    return c.json({ error: "Processing session not found." }, 404);
  }

  const [existing] = await db
    .select()
    .from(reports)
    .where(eq(reports.processingSessionId, processingSessionId))
    .limit(1);
  if (existing) {
    return c.json({
      title: REPORT_1_TITLE,
      reportId: existing.id,
      publicNumber: existing.publicNumber,
      coverage: existing.coverage,
      coverageCaption: coverageCaption(
        existing.coverage as "COMPLETE" | "LIMITED" | "PARTIAL",
      ),
      frozenAt: iso(existing.frozenAt),
      replayed: true,
    });
  }

  const rows = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.processingSessionId, processingSessionId));
  const records = rows.flatMap((row) => {
    const parsed = toRecord(row);
    return parsed ? [parsed] : [];
  });
  if (records.length === 0) {
    return c.json(
      { error: "No evidence in this session. Upload S1 results before freezing Report 1." },
      400,
    );
  }

  const reportId = crypto.randomUUID();
  const frozenAt = new Date();
  const manifest = assembleManifest({
    reportId,
    deviceLifecycleId: asDeviceLifecycleId(session.deviceLifecycleId),
    processingSessionId: asProcessingSessionId(session.id),
    records,
    frozenAt: iso(frozenAt),
  });
  const publicNumber = formatReportNumber(reportId, frozenAt);

  await db.transaction(async (tx) => {
    await tx.insert(reports).values({
      id: reportId,
      userId: user.id,
      deviceLifecycleId: session.deviceLifecycleId,
      processingSessionId: session.id,
      publicNumber,
      coverage: manifest.coverage,
      frozenAt,
    });
    await tx.insert(reportManifests).values({
      reportId,
      snapshot: { ...manifest },
      frozenAt,
    });
  });

  return c.json({
    title: REPORT_1_TITLE,
    reportId,
    publicNumber,
    coverage: manifest.coverage,
    coverageCaption: coverageCaption(manifest.coverage),
    frozenAt: iso(frozenAt),
    replayed: false,
    entries: manifest.entries.map(enrichEntry),
    nongoals: REPORT_1_NONGOALS,
  });
});
