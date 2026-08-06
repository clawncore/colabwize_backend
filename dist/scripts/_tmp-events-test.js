"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const integrations_1 = __importDefault(require("../api/admin/integrations"));
async function hit(path) {
    const stack = integrations_1.default.stack || [];
    const layer = stack.find((l) => l.route?.path === path);
    if (!layer) {
        console.log(`NO ROUTE ${path}`);
        return;
    }
    const handler = layer.route.stack.find((s) => s.method === "get").handle;
    const res = {
        json: (body) => { console.log(`${path}:`, JSON.stringify(body).slice(0, 1500)); },
        status: (code) => ({ json: (b) => { console.log(`STATUS ${code} ${path}:`, JSON.stringify(b).slice(0, 1500)); } }),
    };
    await handler({ query: {} }, res);
}
async function main() {
    await hit("/google-analytics/events");
    process.exit(0);
}
main();
