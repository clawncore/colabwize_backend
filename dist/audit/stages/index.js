"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_STAGES = void 0;
const extract_1 = require("./extract");
const verification_1 = require("./verification");
const duplicateCheck_1 = require("./duplicateCheck");
const urlCheck_1 = require("./urlCheck");
const styleCheck_1 = require("./styleCheck");
const score_1 = require("./score");
const retractionCheck_1 = require("./retractionCheck");
const citationRole_1 = require("./citationRole");
const grobidParse_1 = require("./grobidParse");
exports.ALL_STAGES = [
    grobidParse_1.GrobidParseStage,
    extract_1.ExtractStage,
    verification_1.VerificationStage,
    retractionCheck_1.RetractionCheckStage,
    duplicateCheck_1.DuplicateCheckStage,
    urlCheck_1.UrlCheckStage,
    styleCheck_1.StyleCheckStage,
    citationRole_1.CitationRoleStage,
    score_1.ScoreStage
];
