import crypto from "crypto";
import logger from "../monitoring/logger";

/**
 * Fingerprint Service for Turnitin-style rolling window text matching
 *
 * This service implements a sliding window approach to detect plagiarism at a more
 * granular level than sentence-by-sentence comparison. It creates fingerprints
 * (hashes) for every N-word sequence in a document, allowing detection of:
 * - Partial sentence copying
 * - Reordered content
 * - Copy-paste with minor modifications
 */
export class FingerprintService {
  /**
   * Generate fingerprints using rolling window approach (like Turnitin)
   *
   * @param text - Text to fingerprint
   * @param windowSize - Number of words per fingerprint (default: 8, matching Turnitin)
   * @returns Map of fingerprint hashes to their positions in text
   */
  static generateFingerprints(
    text: string,
    windowSize: number = 8
  ): Map<string, number[]> {
    // Normalize text: lowercase, remove punctuation, split into words
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // Remove punctuation
      .split(/\s+/)
      .filter((w) => w.length > 0); // Remove empty strings

    const fingerprints = new Map<string, number[]>();

    // Create fingerprint for each window
    for (let i = 0; i <= words.length - windowSize; i++) {
      const window = words.slice(i, i + windowSize).join(" ");

      // Create MD5 hash (fast and sufficient for plagiarism detection)
      const hash = crypto
        .createHash("md5")
        .update(window)
        .digest("hex")
        .substring(0, 16); // Use first 16 chars for efficiency

      // Store position of this fingerprint
      if (!fingerprints.has(hash)) {
        fingerprints.set(hash, []);
      }
      fingerprints.get(hash)!.push(i);
    }

    logger.debug("Generated fingerprints", {
      totalWords: words.length,
      uniqueFingerprints: fingerprints.size,
      windowSize,
    });

    return fingerprints;
  }

  /**
   * Compare two sets of fingerprints to calculate similarity percentage
   *
   * @param fp1 - Fingerprints from first document
   * @param fp2 - Fingerprints from second document
   * @returns Similarity score (0-100%)
   */
  static compareFingerprints(
    fp1: Map<string, number[]>,
    fp2: Map<string, number[]>
  ): number {
    if (fp1.size === 0 || fp2.size === 0) {
      return 0;
    }

    let matches = 0;
    let totalChecked = 0;

    // Count matching fingerprints
    for (const hash of fp1.keys()) {
      totalChecked++;
      if (fp2.has(hash)) {
        matches++;
      }
    }

    const similarityPercentage = (matches / totalChecked) * 100;

    logger.debug("Fingerprint comparison", {
      doc1Fingerprints: fp1.size,
      doc2Fingerprints: fp2.size,
      matches,
      similarityPercentage: similarityPercentage.toFixed(2),
    });

    return similarityPercentage;
  }

  /**
   * Find matching segments between two documents using fingerprints
   *
   * @param text1 - First document text
   * @param text2 - Second document text
   * @param windowSize - Window size for finger printing
   * @returns Array of matching segments with positions
   */
  static findMatchingSegments(
    text1: string,
    text2: string,
    windowSize: number = 8
  ): Array<{
    text: string;
    position1: number;
    position2: number;
    length: number;
  }> {
    const fp1 = this.generateFingerprints(text1, windowSize);
    const fp2 = this.generateFingerprints(text2, windowSize);

    const matches: Array<{
      text: string;
      position1: number;
      position2: number;
      length: number;
    }> = [];

    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);

    // Find all matching fingerprints
    for (const [hash, positions1] of fp1.entries()) {
      if (fp2.has(hash)) {
        const positions2 = fp2.get(hash)!;

        // For each match, record the segment
        for (const pos1 of positions1) {
          for (const pos2 of positions2) {
            const segment = words1.slice(pos1, pos1 + windowSize).join(" ");
            matches.push({
              text: segment,
              position1: pos1,
              position2: pos2,
              length: windowSize,
            });
          }
        }
      }
    }

    return matches;
  }

  /**
   * Calculate coverage percentage - how much of doc1 is covered by matches with doc2
   *
   * @param text1 - Source document
   * @param text2 - Comparison document
   * @returns Percentage of source document that matches (0-100%)
   */
  static calculateCoverage(text1: string, text2: string): number {
    const segments = this.findMatchingSegments(text1, text2);

    if (segments.length === 0) {
      return 0;
    }

    const words1 = text1
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const coveredPositions = new Set<number>();

    // Mark all positions covered by matches
    for (const segment of segments) {
      for (let i = 0; i < segment.length; i++) {
        coveredPositions.add(segment.position1 + i);
      }
    }

    const coveragePercentage = (coveredPositions.size / words1.length) * 100;

    logger.debug("Coverage calculation", {
      totalWords: words1.length,
      coveredWords: coveredPositions.size,
      coveragePercentage: coveragePercentage.toFixed(2),
    });

    return coveragePercentage;
  }

  /**
   * Serialize fingerprints for storage (convert Map to plain object)
   */
  static serializeFingerprints(
    fingerprints: Map<string, number[]>
  ): Record<string, number[]> {
    return Object.fromEntries(fingerprints);
  }

  /**
   * Deserialize fingerprints from storage (convert plain object to Map)
   */
  static deserializeFingerprints(
    data: Record<string, number[]>
  ): Map<string, number[]> {
    return new Map(Object.entries(data));
  }
}
