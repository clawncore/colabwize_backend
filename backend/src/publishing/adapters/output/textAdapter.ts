import { cdmToPlainText } from "../../serializers/text";
import { CanonicalDocument, OutputFormat } from "../../cdm";
import {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../../types";
import { buildResult } from "./util";

export class PlainTextAdapter implements OutputAdapter {
  format: OutputFormat = "txt";
  supportedFormats: OutputFormat[] = ["txt"];

  estimateComplexity(): AdapterComplexity {
    return "fast";
  }

  async generate(doc: CanonicalDocument, _ctx: GenCtx): Promise<GenResult> {
    const text = cdmToPlainText(doc);
    return buildResult("txt", Buffer.from(text, "utf8"));
  }
}
