import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

export const IntegrityRulesSchema = z.object({
  aiAllowed: z.enum(['none','outline','research','full']).default('outline'),
  collaborationAllowed: z.boolean().default(true),
  maxCopyPasteChars: z.number().int().positive().optional(),
  citationRequired: z.boolean().default(true),
  allowPeerFeedback: z.boolean().default(true),
});

export type IntegrityRules = z.infer<typeof IntegrityRulesSchema>;

export class AssignmentService {
  static async create(data: {
    workspaceId: string;
    title: string;
    description?: string;
    instructorId: string;
    dueAt?: Date;
    integrityRules: IntegrityRules;
    attestationRequired?: boolean;
  }) {
    const rules = IntegrityRulesSchema.parse(data.integrityRules);
    return prisma.assignment.create({
      data: {
        workspaceId: data.workspaceId,
        title: data.title,
        description: data.description,
        instructorId: data.instructorId,
        dueAt: data.dueAt,
        integrityRules: rules,
        attestationRequired: data.attestationRequired ?? true,
      },
      include: { members: true }
    });
  }

  static async getById(id: string) {
    return prisma.assignment.findUnique({
      where: { id },
      include: { members: true, workspace: true }
    });
  }

  static async updateRules(id: string, rules: IntegrityRules) {
    const parsed = IntegrityRulesSchema.parse(rules);
    return prisma.assignment.update({
      where: { id },
      data: { integrityRules: parsed, updatedAt: new Date() }
    });
  }

  static async addMember(assignmentId: string, userId: string, role = 'student') {
    return prisma.assignmentMember.upsert({
      where: { assignmentId_userId: { assignmentId, userId } },
      update: { role },
      create: { assignmentId, userId, role }
    });
  }

  static async attest(assignmentId: string, projectId: string | null, userId: string, ip?: string, ua?: string) {
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new Error('Assignment not found');
    return prisma.assignmentAttestation.create({
      data: {
        assignmentId,
        projectId,
        userId,
        ipAddress: ip,
        userAgent: ua,
        rulesSnapshot: assignment.integrityRules
      }
    });
  }

  static async getReportData(assignmentId: string, projectId: string) {
    // Reuse existing authorship confidence report
    const report = await prisma.authorshipConfidenceReport.findFirst({
      where: { projectId }
    });
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    return { assignment, report };
  }
}
