import express, { Request, Response } from 'express';
import { z } from 'zod';

import { IntegrityRulesSchema, IntegrityRules } from '../services/assignmentService';
import { AssignmentService } from '../services/assignmentService';

// Local asyncHandler helper
function asyncHandler(fn: (req: Request, res: Response) => Promise<any>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: any) => {
      console.error('[AssignmentRoute] Handler error:', err);
      res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    });
  };
}

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { workspaceId, title, description, dueAt, integrityRules, attestationRequired } = req.body;
  const instructorId = (req as any).user?.id;
  if (!instructorId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const assignment = await AssignmentService.create({
    workspaceId, title, description, instructorId, dueAt, integrityRules, attestationRequired
  });
  res.json({ success: true, data: assignment });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const assignment = await AssignmentService.getById(req.params.id as string);
  if (!assignment) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: assignment });
}));

router.put('/:id/rules', asyncHandler(async (req, res) => {
  const assignment = await AssignmentService.updateRules(req.params.id as string, req.body);
  res.json({ success: true, data: assignment });
}));

router.post('/:id/members', asyncHandler(async (req, res) => {
  const { userId, role } = req.body;
  const member = await AssignmentService.addMember(req.params.id as string, userId, role || 'student');
  res.json({ success: true, data: member });
}));

router.post('/:id/attest', asyncHandler(async (req, res) => {
  const { projectId } = req.body;
  const assignment = await AssignmentService.getById(req.params.id as string);
  if (!assignment) return res.status(404).json({ success: false, error: 'Assignment not found' });
  const attestation = await AssignmentService.attest(
    req.params.id as string,
    projectId,
    (req as any).user?.id,
    req.ip,
    req.get('user-agent')
  );
  res.json({ success: true, data: attestation });
}));

export default router;