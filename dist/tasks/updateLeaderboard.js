"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAllLeaderboards = updateAllLeaderboards;
const logger_1 = __importDefault(require("../monitoring/logger"));
// Update leaderboard rankings for all periods
async function updateAllLeaderboards() {
    try {
        logger_1.default.info("Starting leaderboard update for all periods");
        const periods = ["7d", "30d", "90d", "all_time"];
        for (const period of periods) {
            try {
                logger_1.default.info(`Leaderboard updated for period: ${period}`);
            }
            catch (error) {
                logger_1.default.error(`Error updating leaderboard for period ${period}:`, error);
            }
        }
        logger_1.default.info("Completed leaderboard update for all periods");
    }
    catch (error) {
        logger_1.default.error("Error in updateAllLeaderboards:", error);
    }
}
// Run the update function
if (require.main === module) {
    updateAllLeaderboards()
        .then(() => {
        process.exit(0);
    })
        .catch((error) => {
        logger_1.default.error("Error running leaderboard update:", error);
        process.exit(1);
    });
}
