import { Readable } from "stream";
import {
  createDestinationRegistry,
  InMemoryDestinationRegistry,
  LocalDestinationAdapter,
  CloudStorageDestinationAdapter,
  type CloudUploader,
} from "../index";

function fakeUploader() {
  const calls: Array<{ userId: string; fileName: string; bytes: number }> = [];
  const uploader: CloudUploader = {
    async uploadFile(userId, fileName, stream) {
      const chunks: Buffer[] = [];
      for await (const c of stream as Readable) chunks.push(c as Buffer);
      const bytes = Buffer.concat(chunks).length;
      calls.push({ userId, fileName, bytes });
      return { id: "remote-1", webUrl: `https://cloud/${fileName}` };
    },
  };
  return { uploader, calls };
}

describe("DestinationRegistry", () => {
  it("resolves local and unknown destinations", () => {
    const reg = new InMemoryDestinationRegistry([new LocalDestinationAdapter()]);
    expect(reg.get("local")?.destination).toBe("local");
    expect(reg.get("dropbox")).toBeUndefined();
    expect(reg.list()).toHaveLength(1);
  });

  it("routes a cloud destination to its uploader", async () => {
    const { uploader, calls } = fakeUploader();
    const reg = new InMemoryDestinationRegistry([
      new LocalDestinationAdapter(),
      new CloudStorageDestinationAdapter("google-drive", uploader),
    ]);
    const adapter = reg.get("google-drive")!;
    const out = await adapter.push({
      userId: "u1",
      jobId: "j1",
      fileName: "document.pdf",
      mimeType: "application/pdf",
      getBytes: async () => Buffer.from("hello"),
      artifactUrl: "memory://x",
    });
    expect(out.ok).toBe(true);
    expect(out.remoteUrl).toBe("https://cloud/document.pdf");
    expect(calls).toEqual([
      { userId: "u1", fileName: "document.pdf", bytes: 5 },
    ]);
  });

  it("createDestinationRegistry includes local by default", () => {
    // Avoid constructing real cloud providers by skipping them.
    const reg = createDestinationRegistry();
    expect(reg.get("local")).toBeDefined();
    // local is always present; cloud adapters depend on CloudStorageFacade.
    expect(reg.list().length).toBeGreaterThanOrEqual(1);
  });
});
