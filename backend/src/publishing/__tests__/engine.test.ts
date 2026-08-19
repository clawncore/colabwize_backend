import { PublishingEngine } from "../engine";
import { PandocOutputAdapter } from "../adapters/output/pandocAdapter";
import { PuppeteerPdfAdapter } from "../adapters/output/puppeteerPdfAdapter";
import { buildResult } from "../adapters/output/util";
import type { CanonicalDocument, GenCtx, OutputAdapter } from "../types";
import { makeSampleCdm } from "../test-utils/fixtures";

describe("PublishingEngine registry", () => {
  const engine = new PublishingEngine();

  it("maps formats to the correct adapters", () => {
    expect(engine.getAdapter("docx")).toBeInstanceOf(PandocOutputAdapter);
    expect(engine.getAdapter("latex")).toBeInstanceOf(PandocOutputAdapter);
    expect(engine.getAdapter("rtf")).toBeInstanceOf(PandocOutputAdapter);
    expect(engine.getAdapter("epub")).toBeInstanceOf(PandocOutputAdapter);
    expect(engine.getAdapter("pdf")).toBeInstanceOf(PuppeteerPdfAdapter);
    expect(engine.getAdapter("html")).toBeDefined();
    expect(engine.getAdapter("md")).toBeDefined();
    expect(engine.getAdapter("txt")).toBeDefined();
  });

  it("returns undefined for unregistered formats", () => {
    expect(engine.getAdapter("xyz" as never)).toBeUndefined();
  });
});

describe("PublishingEngine.generate", () => {
  it("selects the adapter and forwards the resolved format via ctx", async () => {
    const calls: { doc: CanonicalDocument; ctx: GenCtx }[] = [];
    const fake: OutputAdapter = {
      format: "docx",
      supportedFormats: ["docx"],
      estimateComplexity: () => "fast",
      generate: async (doc, ctx) => {
        calls.push({ doc, ctx });
        return buildResult(ctx.format ?? "docx", Buffer.from("artifact"));
      },
    };
    const engine = new PublishingEngine([fake]);
    const cdm = makeSampleCdm();
    const res = await engine.generate(cdm, { format: "docx" });

    expect(res.format).toBe("docx");
    expect(res.sizeBytes).toBe("artifact".length);
    expect(calls).toHaveLength(1);
    expect(calls[0].ctx.format).toBe("docx");
    expect(calls[0].ctx.cslStyle).toBe("apa");
    expect(res.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws for an unsupported format", async () => {
    const engine = new PublishingEngine();
    await expect(
      engine.generate(makeSampleCdm(), { format: "xyz" as never }),
    ).rejects.toThrow(/No output adapter/);
  });
});

describe("estimateComplexity (adaptive execution signal)", () => {
  it("Puppeteer PDF reports slow for large documents", () => {
    const big = makeSampleCdm();
    big.body = Array.from({ length: 300 }, () => ({
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "x" }],
    }));
    const adapter = new PuppeteerPdfAdapter();
    expect(adapter.estimateComplexity(big)).toBe("slow");
  });

  it("Puppeteer PDF reports fast for small documents", () => {
    const adapter = new PuppeteerPdfAdapter();
    expect(adapter.estimateComplexity(makeSampleCdm())).toBe("fast");
  });
});
