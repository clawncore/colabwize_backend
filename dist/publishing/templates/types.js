"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateToExportSettings = templateToExportSettings;
/** Map a resolved template onto the export job settings it implies. */
function templateToExportSettings(tpl) {
    return { cslStyle: tpl.cslStyle, enableCiteproc: true };
}
