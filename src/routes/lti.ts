import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Local asyncHandler helper (same pattern as assignments.ts)
function asyncHandler(fn: (req: Request, res: Response) => Promise<any>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: any) => {
      console.error('[LTIRoute] Handler error:', err);
      res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    });
  };
}

const router = express.Router();

router.post('/launch', asyncHandler(async (req, res) => {
  const { id_token, client_id } = req.body;
  if (!id_token || !client_id) {
    return res.status(400).json({ success: false, error: 'Missing id_token or client_id' });
  }

  // Verify JWT audience for MVP
  let payload: any;
  try {
    payload = jwt.verify(id_token, 'dummy') as any;
  } catch (e: any) {
    return res.status(401).json({ success: false, error: 'Invalid JWT: ' + e.message });
  }

  if (payload.aud !== client_id) {
    return res.status(401).json({ success: false, error: 'Token audience mismatch' });
  }

  res.json({ success: true, data: payload });
}));

export default router;