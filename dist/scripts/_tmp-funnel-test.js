"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const analytics_1 = __importDefault(require("../api/admin/analytics"));
async function main() {
    const stack = analytics_1.default.stack || [];
    const layer = stack.find((l) => l.route?.path === "/funnel");
    const handler = layer.route.stack.find((s) => s.method === "get").handle;
    const res = {
        json: (body) => { console.log("FUNNEL:", JSON.stringify(body.data)); process.exit(0); },
        status: (code) => ({ json: (b) => { console.log("STATUS", code, JSON.stringify(b)); process.exit(0); } }),
    };
    await handler({ query: { period: "30d" } }, res);
}
main();
