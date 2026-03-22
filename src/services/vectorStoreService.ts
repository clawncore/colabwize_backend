import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { prisma } from "../lib/prisma";
import { SecretsService } from "./secrets-service";

export class VectorStoreService {
  /**
   * Stores documents in the vector store using direct Prisma inserts.
   * @param documents The documents to store.
   */
  static async storeDocuments(documents: Document[]): Promise<void> {
    const apiKey = await SecretsService.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
    });

    console.log(`Storing ${documents.length} documents...`);

    for (const doc of documents) {
      try {
        // Generate embedding for the document
        console.log("Generating embedding for document...");
        const embedding = await embeddings.embedQuery(doc.pageContent);
        console.log("Embedding generated, length:", embedding.length);

        // Insert directly using Prisma raw SQL to insert into documents table
        console.log("Inserting into database...");
        await prisma.$executeRawUnsafe(
          `INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2::jsonb, $3::vector)`,
          doc.pageContent,
          JSON.stringify(doc.metadata),
          `[${embedding.join(",")}]`, // Convert array to PostgreSQL vector format
        );
        console.log("Document inserted successfully");
      } catch (error) {
        console.error("Error storing document:", error);
        throw error;
      }
    }

    console.log("All documents stored successfully");
  }

  /**
   * Searches for similar documents based on a query.
   * @param query The search query.
   * @param filter Optional metadata filter.
   * @returns Array of matching documents with scores.
   */
  static async search(
    query: string,
    filter?: any,
    k: number = 5,
  ): Promise<Document[]> {
    const apiKey = await SecretsService.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: "text-embedding-3-small", // Ensure consistent model
    });

    // Generate embedding for the query
    const queryEmbedding = await embeddings.embedQuery(query);
    const vectorString = `[${queryEmbedding.join(",")}]`;

    // Construct metadata filter query if filter is provided
    let results: any[];

    if (filter) {
      // Use metadata filtering
      // Note: We're using raw SQL for pgvector similarity search with metadata filter
      // The <=> operator is cosine distance, so 1 - (a <=> b) is cosine similarity
      // We explicitly cast the metadata column and filter to jsonb for the @> operator
      results = await prisma.$queryRawUnsafe(
        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) as similarity
         FROM documents
         WHERE 1 - (embedding <=> $1::vector) > 0.5
         AND metadata @> $2::jsonb
         ORDER BY similarity DESC
         LIMIT $3`,
        vectorString,
        JSON.stringify(filter),
        k,
      );
    } else {
      // No filter, simple similarity search
      results = await prisma.$queryRawUnsafe(
        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) as similarity
         FROM documents
         WHERE 1 - (embedding <=> $1::vector) > 0.5
         ORDER BY similarity DESC
         LIMIT $2`,
        vectorString,
        k,
      );
    }

    // Convert results to Document format
    return results.map(
      (row) =>
        new Document({
          pageContent: row.content,
          metadata: row.metadata,
        }),
    );
  }

  /**
   * Generates an embedding for a given text.
   * Centralized method to ensure consistency and single configuration.
   * @param text The text to generate an embedding for.
   * @returns The embedding vector.
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = await SecretsService.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: "text-embedding-3-small", // Explicitly set model for consistency
    });

    return await embeddings.embedQuery(text);
  }

  /**
   * Stores project content in the vector store.
   * @param projectId The ID of the project
   * @param userId The ID of the user who owns the project
   * @param content The project content (JSON or HTML string)
   */
  static async storeProjectContent(
    projectId: string,
    userId: string,
    content: any,
  ): Promise<void> {
    const apiKey = await SecretsService.getOpenAiApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Extract text from content (handle both JSON and HTML)
    let textContent = "";
    if (typeof content === "string") {
      // HTML string - strip tags for basic text extraction
      textContent = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    } else if (content && typeof content === "object") {
      // Tiptap JSON - extract text recursively
      textContent = this.extractTextFromTiptapJSON(content);
    }

    if (!textContent || textContent.length < 50) {
      console.log(`Project ${projectId} content too short, skipping vectorization`);
      return;
    }

    // Split text into chunks
    const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunks = await splitter.splitText(textContent);
    console.log(`Storing ${chunks.length} chunks for project ${projectId}`);

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: "text-embedding-3-small",
    });

    // First, delete any existing vectors for this project
    await prisma.$executeRawUnsafe(
      `DELETE FROM documents WHERE metadata->>'type' = 'project' AND metadata->>'projectId' = $1`,
      projectId,
    );

    // Store each chunk with metadata
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embeddings.embedQuery(chunk);

      const metadata = {
        type: "project",
        projectId,
        userId,
        chunkIndex: i,
        totalChunks: chunks.length,
      };

      await prisma.$executeRawUnsafe(
        `INSERT INTO documents (content, metadata, embedding) VALUES ($1, $2::jsonb, $3::vector)`,
        chunk,
        JSON.stringify(metadata),
        `[${embedding.join(",")}]`,
      );
    }

    console.log(`Project ${projectId} vectorized successfully`);
  }

  /**
   * Searches for relevant content within a specific project.
   * @param projectId The ID of the project to search within
   * @param query The search query
   * @param k Number of results to return (default: 5)
   * @returns Array of relevant document chunks
   */
  static async searchProjectContext(
    projectId: string,
    query: string,
    k: number = 5,
  ): Promise<Document[]> {
    const filter = {
      type: "project",
      projectId,
    };

    return this.search(query, filter, k);
  }

  /**
   * Extracts plain text from Tiptap JSON content recursively.
   * @param node Tiptap JSON node
   * @returns Extracted text
   */
  private static extractTextFromTiptapJSON(node: any): string {
    if (!node) return "";

    let text = "";

    if (node.text) {
      text += node.text;
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        text += this.extractTextFromTiptapJSON(child) + " ";
      }
    }

    return text.trim();
  }

  /**
   * Deletes all vectorized content for a project.
   * @param projectId The ID of the project
   */
  static async deleteProjectVectors(projectId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DELETE FROM documents WHERE metadata->>'type' = 'project' AND metadata->>'projectId' = $1`,
      projectId,
    );
    console.log(`Deleted vectors for project ${projectId}`);
  }
}
