import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const prisma = new PrismaClient();

export class LtiService {
  static async validateLaunch(token: string, clientId?: string) {
    // Extract kid and issuer from unverified header
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) throw new Error('Invalid token');
    const installation = await prisma.ltiInstallation.findUnique({ where: { clientId } });
    if (!installation) throw new Error('Unknown client');

    const client = jwksClient({ jwksUri: installation.keySetUrl });
    const getKey = (header: any, cb: any) => {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return cb(err);
        const signingKey = key?.getPublicKey();
        cb(null, signingKey);
      });
    };
    return new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        audience: clientId,
        issuer: installation.issuer,
        algorithms: ['RS256']
      }, (err, payload) => {
        if (err) return reject(err);
        resolve(payload);
      });
    });
  }

  static async syncAssignmentFromLms(ltiPayload: any) {
    const { context, resource_link } = ltiPayload;
    const courseId = context.id;
    const assignmentTitle = resource_link.title || 'LTI Assignment';
    // Create workspace/assignment placeholder
    // TODO: map course to workspace, create Assignment with default integrity rules
    return { courseId, assignmentTitle };
  }
}
