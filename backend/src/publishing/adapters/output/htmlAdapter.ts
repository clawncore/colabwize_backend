import { cdmToHtml } from "../../serializers/html";
import { CanonicalDocument, OutputFormat } from "../../cdm";
import {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../../types";
import { buildResult } from "./util";

export class HtmlOutputAdapter implements OutputAdapter {
  format: OutputFormat = "html";
  supportedFormats: OutputFormat[] = ["html"];

  estimateComplexity(): AdapterComplexity {
    return "fast";
  }

  async generate(doc: CanonicalDocument, _ctx: GenCtx): Promise<GenResult> {
    const html = cdmToHtml(doc, { fullDocument: true });
    return buildResult("html", Buffer.from(html, "utf8"));
  }
}
