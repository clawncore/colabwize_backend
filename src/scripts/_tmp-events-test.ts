import integrationsRouter from "../admin/api/integrations";

async function hit(path: string) {
  const stack: any[] = (integrationsRouter as any).stack || [];
  const layer = stack.find((l: any) => l.route?.path === path);
  if (!layer) { console.log(`NO ROUTE ${path}`); return; }
  const handler = layer.route.stack.find((s: any) => s.method === "get").handle;
  const res: any = {
    json: (body: any) => { console.log(`${path}:`, JSON.stringify(body).slice(0, 1500)); },
    status: (code: number) => ({ json: (b: any) => { console.log(`STATUS ${code} ${path}:`, JSON.stringify(b).slice(0, 1500)); } }),
  };
  await handler({ query: {} }, res);
}

async function main() {
  await hit("/google-analytics/events");
  process.exit(0);
}
main();
