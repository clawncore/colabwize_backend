import { Readable } from "stream";

/**
 * Normalized file metadata returned by any storage provider.
 */
export interface ProviderFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  webUrl?: string;
  downloadUrl?: string | null;
}

/**
 * Result of uploading a file to a storage provider.
 */
export interface ProviderUploadResult {
  id: string;
  name: string;
  path: string;
  publicUrl?: string;
  webUrl?: string;
}

/**
 * Unified interface for cloud storage providers.
 *
 * Each provider (Google Drive, OneDrive, Supabase) implements this
 * so that the CloudStorageFacade can delegate without knowing which
 * provider is in use.
 */
export interface IStorageProvider {
  /** Provider identifier: "google-drive" | "onedrive" | "supabase" */
  readonly name: string;

  /**
   * List document files available to the user.
   */
  listFiles(userId: string, folderId?: string): Promise<ProviderFile[]>;

  /**
   * Download a file. Returns a readable stream plus metadata.
   */
  downloadFile(
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }>;

  /**
   * Upload a file from a readable stream.
   */
  uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ): Promise<ProviderUploadResult>;

  /**
   * Delete a file.
   */
  deleteFile(userId: string, fileId: string): Promise<void>;
}
