/**
 * THE PERMISSION MIRROR, CHECKED AGAINST THE SERVER'S OWN TABLE.
 * ==============================================================
 *
 * Two different things are asserted here, and the second is the important one.
 *
 * 1. THE GATE RENDERS WHAT THE TABLE SAYS.
 *    4 roles x 15 permissions = 60 render assertions. The gate is the only
 *    thing between an operator and a control that will be refused, so "the
 *    gate's decision equals `can(role, permission)`" is the invariant, walked
 *    rather than sampled.
 *
 * 2. THE CLIENT'S TABLE EQUALS `rbac.ts`'s TABLE.
 *    Read from disk, parsed, compared entry by entry. A comment-only mirror
 *    would be a mirror that silently rots: the moment somebody adds a
 *    permission on the server and forgets this file, the console would keep
 *    offering - or keep hiding - controls for reasons the server no longer
 *    holds. Reading the source makes that a test failure in this repository
 *    instead of a support ticket in production.
 *
 *    The parse is deliberately shallow (literal lines of `"perm": [roles]`)
 *    and the test asserts it found all fifteen entries first. If `rbac.ts` is
 *    ever reformatted into something this cannot read, the *first* assertion
 *    fails, so the parser never falls back to comparing an empty set and
 *    passing.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LIMITED_AUDIT_ROLES,
  PERMISSIONS,
  PERMISSION_MATRIX,
  STAFF_ROLES,
  can,
  explainRoleRefusal,
  type Permission,
  type StaffRole,
} from "./permissions";
import { PermissionGate } from "./shell/PermissionGate";

/**
 * Locate `rbac.ts` without trusting `import.meta.url`.
 *
 * Vitest rewrites module URLs for its own transform graph, so
 * `fileURLToPath(import.meta.url)` is not reliably a `file:` URL here - it
 * throws "The URL must be of scheme file". The working directory, by contrast,
 * is the package being tested (`apps/web`) for `pnpm --filter @cyvra/web test`
 * and the workspace root for `pnpm -r test`, so both are offered and the first
 * that exists wins. Failing to find it at all is an error, never a skip: a
 * parity test that quietly no-ops when the server file moves is worse than no
 * test, because it reads as coverage.
 */
function findRbacSource(): string {
  const candidates = [
    "services/api/src/admin/rbac.ts",
    "../../services/api/src/admin/rbac.ts",
    "../../../services/api/src/admin/rbac.ts",
    "../../../../services/api/src/admin/rbac.ts",
  ];
  for (const candidate of candidates) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(
    `could not locate services/api/src/admin/rbac.ts from ${process.cwd()}; ` +
      "the client/server permission parity test needs it and must not be skipped.",
  );
}

const RBAC_PATH = findRbacSource();

/** Literal entries of `PERMISSION_MATRIX` as written on the server. */
function readServerMatrix(): Record<string, string[]> {
  const source = readFileSync(RBAC_PATH, "utf8");
  const declaration = source.indexOf("export const PERMISSION_MATRIX");
  expect(declaration, "PERMISSION_MATRIX is missing from rbac.ts").toBeGreaterThan(-1);

  const open = source.indexOf("{", declaration);
  const close = source.indexOf("\n});", open);
  expect(open, "PERMISSION_MATRIX's object literal was not found").toBeGreaterThan(-1);
  expect(close, "PERMISSION_MATRIX's object literal was not closed").toBeGreaterThan(open);

  const body = source.slice(open + 1, close);
  const entries: Record<string, string[]> = {};
  for (const match of body.matchAll(/"([^"]+)":\s*\[([^\]]*)\]/g)) {
    const [, permission, rawRoles] = match;
    entries[permission] = [...rawRoles.matchAll(/"([^"]+)"/g)].map((role) => role[1]);
  }
  return entries;
}

describe("the client's PERMISSION_MATRIX is the server's PERMISSION_MATRIX", () => {
  it("parses all fifteen rows from rbac.ts", () => {
    const server = readServerMatrix();
    // Guard for the parser itself: if a reformat made this read zero entries,
    // every comparison below would be comparing {} to {} and passing.
    expect(Object.keys(server)).toHaveLength(PERMISSIONS.length);
    expect(Object.keys(server).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("grants exactly the same roles to every permission", () => {
    const server = readServerMatrix();
    for (const permission of PERMISSIONS) {
      expect({ permission, roles: PERMISSION_MATRIX[permission] }).toEqual({
        permission,
        roles: server[permission],
      });
    }
  });

  it("mirrors LIMITED_AUDIT_ROLES, which decides whether the scope sentence renders", () => {
    const source = readFileSync(RBAC_PATH, "utf8");
    const declaration = source.indexOf("export const LIMITED_AUDIT_ROLES");
    const close = source.indexOf("]);", declaration);
    expect(declaration, "LIMITED_AUDIT_ROLES is missing from rbac.ts").toBeGreaterThan(-1);
    const slice = source.slice(declaration, close);
    const roles = [...slice.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect([...LIMITED_AUDIT_ROLES]).toEqual(roles);
  });
});

describe("PermissionGate", () => {
  for (const role of STAFF_ROLES) {
    for (const permission of PERMISSIONS) {
      const expected = PERMISSION_MATRIX[permission].includes(role);
      it(`${role} ${expected ? "sees" : "does not see"} "${permission}"`, () => {
        render(
          <PermissionGate
            role={role}
            permission={permission}
            fallback={<span>refused</span>}
          >
            <span>allowed</span>
          </PermissionGate>,
        );
        if (expected) {
          expect(screen.getByText("allowed")).toBeInTheDocument();
          expect(screen.queryByText("refused")).not.toBeInTheDocument();
        } else {
          expect(screen.getByText("refused")).toBeInTheDocument();
          expect(screen.queryByText("allowed")).not.toBeInTheDocument();
        }
      });
    }
  }

  it("fails closed when no role is passed and there is no session", () => {
    render(
      <PermissionGate permission="staff:manage" fallback={<span>refused</span>}>
        <span>allowed</span>
      </PermissionGate>,
    );
    expect(screen.getByText("refused")).toBeInTheDocument();
    expect(screen.queryByText("allowed")).not.toBeInTheDocument();
  });

  it("treats an explicit null role as \"holds nothing\", not as \"unknown\"", () => {
    render(
      <PermissionGate role={null} permission="serial:read" fallback={<span>refused</span>}>
        <span>allowed</span>
      </PermissionGate>,
    );
    expect(screen.getByText("refused")).toBeInTheDocument();
  });
});

describe("can()", () => {
  it("denies every permission to a null role", () => {
    for (const permission of PERMISSIONS) expect(can(null, permission)).toBe(false);
  });

  it("gives SUPER_ADMIN all fifteen, matching §41", () => {
    for (const permission of PERMISSIONS) expect(can("SUPER_ADMIN", permission)).toBe(true);
  });

  it("keeps AUDITOR read-and-export only: no state change passes", () => {
    const writable = PERMISSIONS.filter(
      (permission) => !["serial:read", "report:export", "audit:read"].includes(permission),
    );
    expect(writable.length).toBeGreaterThan(0);
    for (const permission of writable) expect(can("AUDITOR", permission)).toBe(false);
    expect(can("AUDITOR", "serial:read")).toBe(true);
    expect(can("AUDITOR", "report:export")).toBe(true);
    expect(can("AUDITOR", "audit:read")).toBe(true);
  });
});

describe("explainRoleRefusal()", () => {
  it("names the role and the holders, so a disabled entry is an explanation", () => {
    const sentence = explainRoleRefusal("OPERATOR" as StaffRole, "staff:manage");
    expect(sentence).toContain("operator");
    expect(sentence).toContain("staff:manage");
    expect(sentence).toContain("SUPER_ADMIN");
  });

  it("says the session holds no role rather than blaming one", () => {
    const sentence = explainRoleRefusal(null, "serial:read" as Permission);
    expect(sentence).toContain("no role");
    expect(sentence).toContain("serial:read");
  });

  it("is never empty for a denied permission", () => {
    for (const role of [...STAFF_ROLES, null]) {
      for (const permission of PERMISSIONS) {
        if (can(role, permission)) continue;
        expect(explainRoleRefusal(role, permission).trim().length).toBeGreaterThan(10);
      }
    }
  });
});
