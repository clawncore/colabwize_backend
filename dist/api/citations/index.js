"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const missing_link_1 = __importDefault(require("./missing-link"));
const confidence_1 = __importDefault(require("./confidence"));
const create_1 = __importDefault(require("./create"));
const search_1 = __importDefault(require("./search"));
const audit_1 = __importDefault(require("./audit"));
const update_1 = __importDefault(require("./update"));
const graph_1 = __importDefault(require("./graph"));
const gaps_1 = __importDefault(require("./gaps"));
const intent_1 = __importDefault(require("./intent"));
const credibility_1 = __importDefault(require("./credibility"));
const consensus_1 = __importDefault(require("./consensus"));
const list_1 = __importDefault(require("./list"));
const import_1 = __importDefault(require("./import"));
const router = express_1.default.Router();
const content_scan_1 = __importDefault(require("./content-scan"));
const analyze_1 = __importDefault(require("./analyze"));
const batch_analyze_1 = __importDefault(require("./batch-analyze"));
const forensic_audit_1 = __importDefault(require("./forensic-audit"));
// Mount sub-routers - Order matters! Static routes must come before dynamic /:projectId routes
// 1. Static Routes
router.use("/", search_1.default); // /search
router.use("/", batch_analyze_1.default); // /batch-analyze
router.use("/", forensic_audit_1.default); // /forensic-audit
router.use("/", missing_link_1.default); // /find-missing-link
router.use("/", audit_1.default); // /audit
router.use("/", credibility_1.default); // /credibility-score, /batch-credibility
router.use("/", intent_1.default); // /batch-classify-intents (and /:citationId/classify-intent)
router.use("/import", import_1.default); // /import
// 2. Dynamic Routes (/:projectId or /:movieId or /:citationId at the root level)
router.use("/", content_scan_1.default); // /:projectId/content-scan
router.use("/", analyze_1.default); // /:projectId/:citationId/analyze
router.use("/", confidence_1.default); // /confidence/:projectId
router.use("/", update_1.default); // /:projectId/:citationId
router.use("/", graph_1.default); // /:projectId/graph
router.use("/", gaps_1.default); // /:projectId/gaps
router.use("/", consensus_1.default); // /:projectId/consensus
router.use("/", list_1.default); // /:projectId
router.use("/", create_1.default); // /:projectId
exports.default = router;
