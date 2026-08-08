import { describe, expect, it } from "vitest";
import { finalizeObjects } from "../../src/sql/facts.js";
import { makeObject } from "../../src/sql/statements.js";

async function catalogTriggerObject(sql: string) {
  const object = makeObject({ kind: "trigger", name: "trg", schema: "app", table: "t2" }, sql, 0);
  await finalizeObjects([object], {});
  return object;
}

describe("catalog trigger extraction", () => {
  it("records the qualified trigger function identity during statement finalization", async () => {
    const object = await catalogTriggerObject(
      "CREATE TRIGGER trg AFTER INSERT ON app.t2 FOR EACH ROW EXECUTE FUNCTION app.tf()"
    );

    expect(object.metadata.triggerFunction).toBe("app.tf");
  });

  it("defaults an unqualified trigger function to the public schema", async () => {
    const object = await catalogTriggerObject(
      "CREATE TRIGGER trg AFTER INSERT ON app.t2 FOR EACH ROW EXECUTE FUNCTION tf()"
    );

    expect(object.metadata.triggerFunction).toBe("public.tf");
  });
});
