import { ExtractStage } from "./extract";
import { VerificationStage } from "./verification";
import { DuplicateCheckStage } from "./duplicateCheck";
import { UrlCheckStage } from "./urlCheck";
import { StyleCheckStage } from "./styleCheck";
import { ScoreStage } from "./score";
import { RetractionCheckStage } from "./retractionCheck";
import { CitationRoleStage } from "./citationRole";
import { GrobidParseStage } from "./grobidParse";

export const ALL_STAGES = [
    GrobidParseStage,
    ExtractStage,
    VerificationStage,
    RetractionCheckStage,
    DuplicateCheckStage,
    UrlCheckStage,
    StyleCheckStage,
    CitationRoleStage,
    ScoreStage
];
