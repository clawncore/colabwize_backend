import router from "../api/admin/analytics";

async function main() {
  const stack: any[] = (router as any).stack || [];
  const layer = stack.find((l: any) => l.route?.path === "/funnel");
  const handler = layer.route.stack.find((s: any) => s.method === "get").handle;
  const res: any = {
    json: (body: any) => { console.log("FUNNEL:", JSON.stringify(body.data)); process.exit(0); },
    status: (code: number) => ({ json: (b: any) => { console.log("STATUS", code, JSON.stringify(b)); process.exit(0); } }),
  };
  await handler({ query: { period: "30d" } }, res);
}
main();
