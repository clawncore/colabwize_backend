import { cdmToMarkdown } from "../../serializers/markdown";
import { CanonicalDocument, OutputFormat } from "../../cdm";
import {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../../types";
import { buildResult } from "./util";

export class MarkdownOutputAdapter implements OutputAdapter {
  format: OutputFormat = "md";
  supportedFormats: OutputFormat[] = ["md"];

  estimateComplexity(): AdapterComplexity {
    return "fast";
  }

  async generate(doc: CanonicalDocument, _ctx: GenCtx): Promise<GenResult> {
    const md = cdmToMarkdown(doc);
    return buildResult("md", Buffer.from(md, "utf8"));
  }
}
