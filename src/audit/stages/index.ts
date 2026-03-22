import { ExtractStage } from "./extract";
import { VerificationStage } from "./verification";
import { DuplicateCheckStage } from "./duplicateCheck";
import { UrlCheckStage } from "./urlCheck";
import { StyleCheckStage } from "./styleCheck";
import { ScoreStage } from "./score";

export const ALL_STAGES = [
    ExtractStage,
    VerificationStage, // Replaces naive MapStage
    DuplicateCheckStage,
    UrlCheckStage,
    StyleCheckStage,
    ScoreStage
];
