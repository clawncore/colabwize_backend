"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_STAGES = void 0;
const extract_1 = require("./extract");
const verification_1 = require("./verification");
const duplicateCheck_1 = require("./duplicateCheck");
const urlCheck_1 = require("./urlCheck");
const styleCheck_1 = require("./styleCheck");
const score_1 = require("./score");
exports.ALL_STAGES = [
    extract_1.ExtractStage,
    verification_1.VerificationStage, // Replaces naive MapStage
    duplicateCheck_1.DuplicateCheckStage,
    urlCheck_1.UrlCheckStage,
    styleCheck_1.StyleCheckStage,
    score_1.ScoreStage
];
