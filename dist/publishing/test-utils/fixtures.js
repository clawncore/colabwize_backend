"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSampleCdm = makeSampleCdm;
const cdm_1 = require("../cdm");
/** Minimal but representative CDM used across publishing tests. */
function makeSampleCdm() {
    return {
        schemaVersion: "1.0",
        metadata: (0, cdm_1.defaultCanonicalMetadata)({ title: "My Paper" }),
        settings: (0, cdm_1.defaultCanonicalSettings)({ cslStyle: "apa" }),
        body: [
            { type: "heading", level: 1, content: [{ type: "text", text: "Introduction" }] },
            {
                type: "paragraph",
                content: [
                    { type: "text", text: "See " },
                    {
                        type: "citation",
                        citationId: "smith2023",
                        text: "(Smith, 2023)",
                        status: "resolved",
                    },
                    { type: "text", text: " for details." },
                    { type: "math", latex: "E = mc^2" },
                ],
            },
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "User input: <script>alert(1)</script>",
                    },
                ],
            },
            {
                type: "table",
                rows: [
                    {
                        type: "tableRow",
                        isHeader: true,
                        cells: [
                            { type: "tableCell", isHeader: true, content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                            { type: "tableCell", isHeader: true, content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
                        ],
                    },
                    {
                        type: "tableRow",
                        cells: [
                            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
                            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
                        ],
                    },
                ],
            },
        ],
        references: [
            { id: "smith2023", raw: "Smith, J. (2023). A Study. Journal." },
        ],
        assets: [],
    };
}
