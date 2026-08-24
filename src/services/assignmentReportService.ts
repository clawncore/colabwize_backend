import { AssignmentService } from './assignmentService';
import { WritingEvidenceService } from '../services/writingEvidenceService';
import { AuthorshipService } from '../services/authorshipService';

export class AssignmentReportService {
  static async generate(assignmentId: string, projectId: string) {
    const { assignment, report } = await AssignmentService.getReportData(assignmentId, projectId);
    const snapshot = await WritingEvidenceService.loadLatestReport(projectId);
    
    const compliance = {
      aiAllowed: assignment?.integrityRules.aiAllowed,
      aiUsed: snapshot?.metrics?.averageTypingSpeedCPM ?? 0,
      // Add rule checks here
    };

    return {
      assignment,
      authorshipReport: report,
      writingSnapshot: snapshot,
      compliance,
      generatedAt: new Date().toISOString()
    };
  }
}
