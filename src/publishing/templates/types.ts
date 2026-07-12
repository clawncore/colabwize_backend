import type { CslStyle, OutputFormat, PageGeometry } from "../cdm";

/** A user-fillable variable a template exposes (e.g. journal name, course). */
export interface TemplateVariable {
  key: string;
  label: string;
  required: boolean;
  default?: string;
}

/** A template resolved for use by the export pipeline. */
export interface ResolvedTemplate {
  id: string;
  name: string;
  description?: string;
  isBuiltin: boolean;
  format: OutputFormat;
  cslStyle: CslStyle;
  geometry: PageGeometry;
  variables: TemplateVariable[];
}

export interface PublishingTemplateInput {
  name: string;
  description?: string;
  format: OutputFormat;
  cslStyle: CslStyle;
  geometry?: PageGeometry;
  variables?: TemplateVariable[];
}

/** Map a resolved template onto the export job settings it implies. */
export function templateToExportSettings(tpl: ResolvedTemplate): {
  cslStyle: CslStyle;
  enableCiteproc: boolean;
} {
  return { cslStyle: tpl.cslStyle, enableCiteproc: true };
}
