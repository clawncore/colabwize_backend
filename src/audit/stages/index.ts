import { ExtractStage } from "./extract";
import { MapStage } from "./map";
import { DuplicateCheckStage } from "./duplicateCheck";
import { UrlCheckStage } from "./urlCheck";
import { StyleCheckStage } from "./styleCheck";
import { ScoreStage } from "./score";

export const ALL_STAGES = [
    ExtractStage,
    MapStage,
    DuplicateCheckStage,
    UrlCheckStage,
    StyleCheckStage,
    ScoreStage
];
