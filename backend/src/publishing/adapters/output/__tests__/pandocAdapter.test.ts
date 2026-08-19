import { PandocOutputAdapter, PandocRunner } from "../pandocAdapter";
import type { CanonicalDocument } from "../../cdm";
import { makeSampleCdm } from "../../../test-utils/fixtures";

function makeRunner(): { runner: PandocRunner; calls: { args: string[]; input: string }[] } {
  const calls: { args: string[]; input: string }[] = [];
  const runner: PandocRunner = {
    async run(args: string[], input: string) {
      calls.push({ args, input });
      return Buffer.from(`pandoc-output:${args.join(",")}`);
    },
  };
  return { runner, calls };
}

describe("PandocOutputAdapter", () => {
  it("converts CDM->HTML and invokes pandoc with the requested target format", async () => {
    const { runner, calls } = makeRunner();
    const adapter = new PandocOutputAdapter({
      format: "docx",
      formats: ["docx", "latex", "rtf", "epub"],
      runner,
    });

    const res = await adapter.generate(makeSampleCdm(), { format: "latex" });

    expect(res.format).toBe("latex");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["-f", "html", "-t", "latex", "-o", "-"]),
    );
    // Bibliography is self-rendered into the HTML input (ColabWize owns
    // citations; Pandoc only converts) with stable `#ref-` anchors.
    expect(calls[0].input).toContain("ref-smith2023");
    expect(calls[0].input).toContain("Smith, J. (2023). A Study. Journal.");
  });

  it("self-renders the bibliography and passes document metadata (never citeproc)", async () => {
    const { runner, calls } = makeRunner();
    const adapter = new PandocOutputAdapter({
      format: "docx",
      formats: ["docx"],
      runner,
    });
    const cdm: CanonicalDocument = makeSampleCdm();
    cdm.references[0].cslJson = {
      type: "article-journal",
      title: "A Study",
      author: [{ family: "Smith", given: "J." }],
      issued: { "date-parts": [[2023]] },
    };

    // Even when a caller requests citeproc, the adapter self-renders so the
    // in-text `#ref-` anchors survive the conversion.
    await adapter.generate(cdm, {
      format: "docx",
      enableCiteproc: true,
      cslStyle: "ieee",
    });

    expect(calls[0].args).not.toContain("--citeproc");
    // Document metadata is carried via -M flags.
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["-M", "title=My Paper"]),
    );
  });

  it("does not enable citeproc when references lack CSL-JSON", async () => {
    const { runner, calls } = makeRunner();
    const adapter = new PandocOutputAdapter({ format: "docx", formats: ["docx"], runner });
    await adapter.generate(makeSampleCdm(), { format: "docx", enableCiteproc: true });
    expect(calls[0].args).not.toContain("--citeproc");
  });
});
