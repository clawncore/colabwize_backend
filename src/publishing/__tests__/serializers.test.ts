import { cdmToHtml, escapeHtml } from "../serializers/html";
import { cdmToMarkdown } from "../serializers/markdown";
import { cdmToPlainText } from "../serializers/text";
import { makeSampleCdm } from "../test-utils/fixtures";

describe("cdmToHtml", () => {
  const html = cdmToHtml(makeSampleCdm());

  it("renders in-text citations as anchors to the bibliography", () => {
    expect(html).toContain('<a href="#ref-smith2023"');
    expect(html).toContain('class="citation"');
    expect(html).toContain("(Smith, 2023)");
  });

  it("appends a bibliography section with reference ids", () => {
    expect(html).toContain('<section class="references">');
    expect(html).toContain('<li id="ref-smith2023" class="reference"');
    expect(html).toContain("Smith, J. (2023). A Study. Journal.");
  });

  it("escapes user text to prevent XSS", () => {
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders tables with header row in thead", () => {
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>A</th>");
  });
});

describe("cdmToMarkdown", () => {
  const md = cdmToMarkdown(makeSampleCdm());
  it("renders a references section", () => {
    expect(md).toContain("## References");
    expect(md).toContain("- Smith, J. (2023). A Study. Journal.");
  });
  it("renders headings with # prefix", () => {
    expect(md).toContain("# Introduction");
  });
});

describe("cdmToPlainText", () => {
  const text = cdmToPlainText(makeSampleCdm());
  it("includes a plain references block", () => {
    expect(text).toContain("REFERENCES");
    expect(text).toContain("Smith, J. (2023). A Study. Journal.");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
