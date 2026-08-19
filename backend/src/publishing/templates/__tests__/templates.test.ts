import {
  InMemoryTemplateResolver,
  PrismaTemplateResolver,
  type TemplateResolver,
} from "../engine";
import { templateToExportSettings, type ResolvedTemplate } from "../types";
import { listCslStyles, getCslStyleFile, BUILTIN_CSL_STYLES } from "../csl";
import type { PublishingTemplateInput } from "../types";

const sample: ResolvedTemplate = {
  id: "apa-docx",
  name: "APA Document",
  description: "APA 7th, A4",
  isBuiltin: true,
  format: "docx",
  cslStyle: "apa",
  geometry: {
    size: "A4",
    margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
    columns: 1,
  },
  variables: [{ key: "course", label: "Course", required: true }],
};

describe("CSL registry (migrated engine)", () => {
  it("lists the built-in styles with files", () => {
    const styles = listCslStyles();
    expect(styles.map((s) => s.id)).toEqual([...BUILTIN_CSL_STYLES]);
    const apa = styles.find((s) => s.id === "apa");
    expect(apa?.file).toBe("apa.csl");
    expect(apa?.label).toContain("APA");
  });

  it("resolves a CSL file name", () => {
    expect(getCslStyleFile("ieee")).toBe("ieee.csl");
    expect(getCslStyleFile("nope")).toBeUndefined();
  });
});

describe("TemplateResolver", () => {
  function make(): TemplateResolver {
    return new InMemoryTemplateResolver([sample]);
  }

  it("resolves a seeded built-in template", async () => {
    const tpl = await make().resolve("apa-docx");
    expect(tpl.name).toBe("APA Document");
    expect(tpl.format).toBe("docx");
    expect(tpl.cslStyle).toBe("apa");
    expect(tpl.variables[0].key).toBe("course");
  });

  it("throws on unknown template", async () => {
    await expect(make().resolve("nope")).rejects.toThrow();
  });

  it("lists includes built-ins", async () => {
    const list = await make().list("user-1");
    expect(list.map((t) => t.id)).toContain("apa-docx");
  });

  it("creates a custom template owned by the caller", async () => {
    const resolver = make();
    const input: PublishingTemplateInput = {
      name: "My IEEE",
      format: "pdf",
      cslStyle: "ieee",
      variables: [{ key: "journal", label: "Journal", required: false }],
    };
    const created = await resolver.create("user-1", input);
    expect(created.isBuiltin).toBe(false);
    expect(created.format).toBe("pdf");
    expect(created.cslStyle).toBe("ieee");
    const fetched = await resolver.resolve(created.id);
    expect(fetched.id).toBe(created.id);
  });
});

describe("templateToExportSettings", () => {
  it("maps a template to CSL + citeproc settings", () => {
    const settings = templateToExportSettings(sample);
    expect(settings.cslStyle).toBe("apa");
    expect(settings.enableCiteproc).toBe(true);
  });
});

// Reference the Prisma impl so it is exercised by the type-checker and any
// future integration suite; instantiation is lazy (no DB at construction).
describe("PrismaTemplateResolver (construction)", () => {
  it("can be constructed without touching the database", () => {
    expect(new PrismaTemplateResolver()).toBeInstanceOf(PrismaTemplateResolver);
  });
});
