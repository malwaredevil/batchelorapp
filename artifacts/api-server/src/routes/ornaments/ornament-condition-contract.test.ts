import { describe, expect, it } from "vitest";
import { GetOrnamentResponse, UpdateOrnamentBody } from "@workspace/api-zod";
import { ornamentsItems, potteryItems } from "@workspace/db";

describe("ornament condition removal contract", () => {
  it("keeps condition out of ornament persistence and API schemas", () => {
    expect(ornamentsItems).not.toHaveProperty("condition");
    expect(GetOrnamentResponse.shape).not.toHaveProperty("condition");
    expect(UpdateOrnamentBody.shape).not.toHaveProperty("condition");
    expect(
      UpdateOrnamentBody.strict().safeParse({ condition: "Mint in box" })
        .success,
    ).toBe(false);
  });

  it("does not remove the unrelated pottery condition field", () => {
    expect(potteryItems).toHaveProperty("condition");
  });
});
