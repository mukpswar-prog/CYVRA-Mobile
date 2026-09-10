import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  capabilityProfiles,
  deviceLifecycles,
  evidenceBatches,
  evidenceRecords,
  processingSessions,
} from "@cyvra/database/schema";
import {
  assertS1Honesty,
  isUuid,
  parseEvidenceIngest,
  type EvidenceBatch,
  type EvidenceIngestRequest,
  type EvidenceRecord,
} from "@cyvra/evidence";
import type { Database } from "./db";
import type { Env } from "./env";
import { requireUser, type SessionUser } from "./user";

class OwnedConflict extends Error {
  constructor(readonly resource: string) {
    super(`${resource} is owned by another account`);
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function recordRow(record: EvidenceRecord) {
  return {
    id: record.evidenceId,
    deviceLifecycleId: record.deviceLifecycleId,
    processingSessionId: record.processingSessionId,
    testId: record.testId,
    source: record.source,
    result: record.result,
    collectedAt: new Date(record.collectedAt),
    method: record.method,
    limitation: record.limitation ?? null,
    notes: record.notes ?? null,
    payload: record.payload ?? null,
    digest: record.digest ?? null,
  };
}

async function assertOwned(
  db: Database,
  user: SessionUser,
  batch: EvidenceBatch,
): Promise<void> {
  const [lifecycle] = await db
    .select({ userId: deviceLifecycles.userId })
    .from(deviceLifecycles)
    .where(eq(deviceLifecycles.id, batch.deviceLifecycleId))
    .limit(1);
  if (lifecycle && lifecycle.userId !== user.id) {
    throw new OwnedConflict("device lifecycle");
  }

  const [session] = await db
    .select({ userId: processingSessions.userId })
    .from(processingSessions)
    .where(eq(processingSessions.id, batch.processingSessionId))
    .limit(1);
  if (session && session.userId !== user.id) {
    throw new OwnedConflict("processing session");
  }

  const [existingBatch] = await db
    .select({ userId: evidenceBatches.userId })
    .from(evidenceBatches)
    .where(eq(evidenceBatches.id, batch.batchId))
    .limit(1);
  if (existingBatch && existingBatch.userId !== user.id) {
    throw new OwnedConflict("evidence batch");
  }
}

async function upsertOwnedGraph(
  db: Database,
  user: SessionUser,
  ingest: EvidenceIngestRequest,
): Promise<{ inserted: number; replayed: boolean }> {
  const { batch, profile } = ingest;

  await db
    .insert(deviceLifecycles)
    .values({
      id: batch.deviceLifecycleId,
      userId: user.id,
      manufacturer: profile?.manufacturer ?? null,
      model: profile?.model ?? null,
    })
    .onConflictDoNothing();

  await db
    .insert(processingSessions)
    .values({
      id: batch.processingSessionId,
      deviceLifecycleId: batch.deviceLifecycleId,
      userId: user.id,
    })
    .onConflictDoNothing();

  const insertedBatch = await db
    .insert(evidenceBatches)
    .values({
      id: batch.batchId,
      deviceLifecycleId: batch.deviceLifecycleId,
      processingSessionId: batch.processingSessionId,
      userId: user.id,
      clientCreatedAt: new Date(batch.createdAt),
      recordCount: batch.records.length,
    })
    .onConflictDoNothing()
    .returning({ id: evidenceBatches.id });

  if (profile) {
    await db
      .insert(capabilityProfiles)
      .values({
        id: profile.profileId,
        deviceLifecycleId: profile.deviceLifecycleId,
        processingSessionId: profile.processingSessionId,
        version: profile.version,
        capturedAt: new Date(profile.capturedAt),
        snapshot: { ...profile },
      })
      .onConflictDoNothing();
  }

  let inserted = 0;
  if (batch.records.length > 0) {
    const written = await db
      .insert(evidenceRecords)
      .values(batch.records.map(recordRow))
      .onConflictDoNothing()
      .returning({ id: evidenceRecords.id });
    inserted = written.length;
  }

  await assertOwned(db, user, batch);
  return { inserted, replayed: insertedBatch.length === 0 };
}

export const evidenceRoutes = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

evidenceRoutes.post("/batches", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Sign in required." }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = parseEvidenceIngest(body);
  if (!parsed.ok) {
    return c.json(
      { error: "Evidence batch failed G4 schema validation.", issues: parsed.issues },
      400,
    );
  }

  const { batch, profile } = parsed.value;
  for (const record of batch.records) {
    if (record.deviceLifecycleId !== batch.deviceLifecycleId) {
      return c.json(
        { error: "Record deviceLifecycleId must match the batch." },
        400,
      );
    }
    if (record.processingSessionId !== batch.processingSessionId) {
      return c.json(
        { error: "Record processingSessionId must match the batch." },
        400,
      );
    }
    if (record.source !== "S1_APPLICATION") {
      return c.json(
        {
          error: "This endpoint accepts S1_APPLICATION evidence only.",
          testId: record.testId,
        },
        400,
      );
    }
  }

  if (profile) {
    if (profile.deviceLifecycleId !== batch.deviceLifecycleId) {
      return c.json(
        { error: "Profile deviceLifecycleId must match the batch." },
        400,
      );
    }
    if (profile.processingSessionId !== batch.processingSessionId) {
      return c.json(
        { error: "Profile processingSessionId must match the batch." },
        400,
      );
    }
  }

  const honesty = batch.records.flatMap((record) => assertS1Honesty(record));
  if (honesty.length > 0) {
    return c.json(
      { error: "Dishonest S1 evidence rejected.", issues: honesty },
      400,
    );
  }

  const db = c.get("db");
  try {
    await assertOwned(db, user, batch);
    const result = await db.transaction(async (tx) =>
      upsertOwnedGraph(tx, user, parsed.value),
    );

    const stored = await db
      .select({
        evidenceId: evidenceRecords.id,
        collectedAt: evidenceRecords.collectedAt,
        result: evidenceRecords.result,
        testId: evidenceRecords.testId,
      })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.processingSessionId, batch.processingSessionId));

    return c.json({
      batchId: batch.batchId,
      deviceLifecycleId: batch.deviceLifecycleId,
      processingSessionId: batch.processingSessionId,
      accepted: batch.records.length,
      inserted: result.inserted,
      replayed: result.replayed,
      records: stored.map((row) => ({
        evidenceId: row.evidenceId,
        testId: row.testId,
        result: row.result,
        collectedAt: iso(row.collectedAt),
      })),
    });
  } catch (error) {
    if (error instanceof OwnedConflict) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

evidenceRoutes.get("/records", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Sign in required." }, 401);
  }

  const processingSessionId = (c.req.query("processingSessionId") ?? "").trim();
  if (!isUuid(processingSessionId)) {
    return c.json({ error: "processingSessionId must be a UUID." }, 400);
  }

  const db = c.get("db");
  const rows = await db
    .select({
      evidenceId: evidenceRecords.id,
      deviceLifecycleId: evidenceRecords.deviceLifecycleId,
      processingSessionId: evidenceRecords.processingSessionId,
      testId: evidenceRecords.testId,
      source: evidenceRecords.source,
      result: evidenceRecords.result,
      collectedAt: evidenceRecords.collectedAt,
      method: evidenceRecords.method,
      limitation: evidenceRecords.limitation,
      notes: evidenceRecords.notes,
    })
    .from(evidenceRecords)
    .innerJoin(
      processingSessions,
      eq(evidenceRecords.processingSessionId, processingSessions.id),
    )
    .where(
      and(
        eq(evidenceRecords.processingSessionId, processingSessionId),
        eq(processingSessions.userId, user.id),
      ),
    );

  return c.json({
    processingSessionId,
    records: rows.map((row) => ({
      ...row,
      collectedAt: iso(row.collectedAt),
    })),
  });
});
